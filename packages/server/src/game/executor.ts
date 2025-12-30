/**
 * Game Action Executor
 *
 * Server-side execution of game actions with validation.
 */

import {
  executeAction,
  generateMap,
  generateUnits,
  startCombat,
  type GameAction,
  type GameState,
  type GameEvent,
  type Unit,
  type CombatState,
} from "@rune-forge/simulation";
import { getDb } from "../db/index.js";
import { broadcastToSession } from "../ws/index.js";
import { getSession } from "./session.js";
import { createDelta, type GameSessionState, type StateDelta } from "./state.js";

/**
 * Result of executing an action.
 */
export interface ExecutionResult {
  success: boolean;
  events: GameEvent[];
  delta?: StateDelta;
  error?: string;
}

/**
 * Initialize game state when starting a session.
 */
export function initializeGame(sessionId: string): GameState {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const players = db.sessions.getPlayers(sessionId);

  // Generate map with session seed
  const map = generateMap(session.config.mapSeed, 20, 20);

  // Create player units from characters
  const playerUnits: Unit[] = [];
  const spawnPositions = getPlayerSpawnPositions(players.length);

  for (let i = 0; i < players.length; i++) {
    const player = players[i]!;
    const character = db.characters.findById(player.characterId);

    if (!character) continue;

    const unit: Unit = {
      id: `player-${player.userId}`,
      name: character.name,
      team: "player",
      position: spawnPositions[i]!,
      stats: calculateCharacterStats(character.class, character.level),
      hp: 0, // Will be set to maxHp
      isPlayer: true,
    };
    unit.hp = unit.stats.maxHp;

    playerUnits.push(unit);

    // Assign unit ID to player in database
    db.sessions.assignUnitId(sessionId, player.userId, unit.id);
  }

  // Generate monsters based on difficulty
  const monsterCount = getMonsterCount(session.config.difficulty, players.length);
  const monsters = generateUnits(monsterCount, "monster", session.config.mapSeed);

  // Combine units
  const units = [...playerUnits, ...monsters];

  // Create initial game state (combat not started yet)
  const initialState: GameState = {
    map,
    units,
    combat: {
      phase: "setup",
      initiativeOrder: [],
      turnState: null,
      turnNumber: 0,
      roundNumber: 0,
    },
    loot: [],
    playerInventory: {
      gold: 0,
      silver: 0,
      items: [],
    },
  };

  // Start combat (this rolls initiative and sets up turn order)
  const combatResult = startCombat(initialState, session.config.mapSeed);
  const gameState = combatResult.state;

  // Save to database
  session.gameState = gameState;
  session.stateVersion = 1;
  db.sessions.updateGameState(sessionId, gameState, 1);

  console.log(`[game] Initialized game for session ${sessionId} with ${players.length} players and ${monsters.length} monsters`);

  return gameState;
}

/**
 * Execute a game action.
 */
export function executeGameAction(
  sessionId: string,
  userId: string,
  action: GameAction
): ExecutionResult {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) {
    return { success: false, events: [], error: "SESSION_NOT_FOUND" };
  }

  if (session.status !== "playing") {
    return { success: false, events: [], error: "GAME_NOT_STARTED" };
  }

  if (!session.gameState) {
    return { success: false, events: [], error: "GAME_STATE_NOT_INITIALIZED" };
  }

  // Get player's unit
  const player = db.sessions.getPlayer(sessionId, userId);
  if (!player || !player.unitId) {
    return { success: false, events: [], error: "PLAYER_NOT_IN_GAME" };
  }

  // Verify it's the player's turn
  const currentUnit = session.gameState.units.find(
    (u) => u.id === session.gameState!.combat.turnState?.unitId
  );

  if (!currentUnit || currentUnit.id !== player.unitId) {
    return { success: false, events: [], error: "NOT_YOUR_TURN" };
  }

  // Validate action references correct unit
  if ("unitId" in action && action.unitId !== player.unitId) {
    return { success: false, events: [], error: "INVALID_UNIT" };
  }

  // Execute the action
  const oldState = session.gameState;
  const oldVersion = session.stateVersion;

  try {
    const result = executeAction(action, session.gameState);

    if (!result.success) {
      return {
        success: false,
        events: [],
        error: result.error ?? "INVALID_ACTION",
      };
    }

    // Update session state
    session.gameState = result.state;
    session.stateVersion += 1;
    session.eventLog.push(...result.events);

    // Create delta for sync
    const delta = createDelta(
      oldState,
      result.state,
      oldVersion,
      session.stateVersion
    );

    // Persist to database
    db.sessions.updateGameState(sessionId, result.state, session.stateVersion);
    db.sessions.appendEvents(sessionId, result.events);

    // Broadcast events and delta to all players
    broadcastToSession(sessionId, "events", { events: result.events });
    broadcastToSession(sessionId, "state_delta", { delta });

    // Check for game over
    checkGameOver(session);

    // Handle turn change
    if (result.events.some((e) => e.type === "turn_changed")) {
      handleTurnChange(session);
    }

    return {
      success: true,
      events: result.events,
      delta,
    };
  } catch (error) {
    console.error(`[game] Action execution error:`, error);
    return {
      success: false,
      events: [],
      error: "EXECUTION_ERROR",
    };
  }
}

/**
 * Check if the game is over.
 */
function checkGameOver(session: GameSessionState): void {
  if (!session.gameState) return;

  const phase = session.gameState.combat.phase;

  if (phase === "victory" || phase === "defeat") {
    const { endSession } = require("./session.js");
    endSession(session.id, phase);
  }
}

/**
 * Handle turn change.
 */
function handleTurnChange(session: GameSessionState): void {
  if (!session.gameState) return;

  const currentUnitId = session.gameState.combat.turnState?.unitId;
  if (!currentUnitId) return;

  // Find the player whose turn it is
  const db = getDb();
  const players = db.sessions.getPlayers(session.id);
  const currentPlayer = players.find((p) => p.unitId === currentUnitId);

  if (currentPlayer) {
    session.currentTurnUserId = currentPlayer.userId;
    session.turnStartedAt = Date.now();

    // Set turn timeout if configured
    if (session.config.turnTimeLimit > 0) {
      if (session.turnTimeoutId) {
        clearTimeout(session.turnTimeoutId);
      }

      session.turnTimeoutId = setTimeout(() => {
        handleTurnTimeout(session.id);
      }, session.config.turnTimeLimit * 1000);
    }
  } else {
    // Monster turn - execute AI
    session.currentTurnUserId = null;
    executeMonsterTurn(session);
  }

  // Broadcast turn change
  broadcastToSession(session.id, "turn_change", {
    currentUnitId,
    currentUserId: currentPlayer?.userId ?? null,
    turnNumber: session.gameState.combat.turnNumber,
    isPlayerTurn: !!currentPlayer,
  });
}

/**
 * Handle turn timeout.
 */
function handleTurnTimeout(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session || !session.gameState) return;

  console.log(`[game] Turn timeout for session ${sessionId}`);

  // Auto end turn
  const result = executeAction({ type: "end_turn" }, session.gameState);

  if (result.success) {
    session.gameState = result.state;
    session.stateVersion += 1;

    broadcastToSession(sessionId, "events", { events: result.events });
    broadcastToSession(sessionId, "turn_timeout", {});

    handleTurnChange(session);
  }
}

/**
 * Execute monster AI turn.
 */
function executeMonsterTurn(session: GameSessionState): void {
  if (!session.gameState) return;

  // Simple AI: end turn after a short delay
  // TODO: Implement actual monster AI
  setTimeout(() => {
    if (!session.gameState) return;

    const result = executeAction({ type: "end_turn" }, session.gameState);

    if (result.success) {
      session.gameState = result.state;
      session.stateVersion += 1;

      broadcastToSession(session.id, "events", { events: result.events });

      handleTurnChange(session);
    }
  }, 1000);
}

/**
 * Get spawn positions for players.
 */
function getPlayerSpawnPositions(
  playerCount: number
): Array<{ x: number; y: number }> {
  // Spawn players in bottom-left area
  const positions = [
    { x: 2, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 3 },
    { x: 3, y: 3 },
    { x: 4, y: 2 },
    { x: 4, y: 3 },
    { x: 2, y: 4 },
    { x: 3, y: 4 },
  ];

  return positions.slice(0, playerCount);
}

/**
 * Calculate character stats from class and level.
 */
function calculateCharacterStats(
  characterClass: string,
  level: number
): Unit["stats"] {
  const baseStats: Record<string, Unit["stats"]> = {
    warrior: { maxHp: 12, attack: 4, defense: 3, initiative: 2, moveRange: 3 },
    ranger: { maxHp: 10, attack: 3, defense: 2, initiative: 4, moveRange: 4 },
    mage: { maxHp: 8, attack: 5, defense: 1, initiative: 3, moveRange: 3 },
    rogue: { maxHp: 9, attack: 3, defense: 2, initiative: 5, moveRange: 5 },
  };

  const base = baseStats[characterClass] ?? baseStats.warrior!;

  return {
    maxHp: Math.floor(base.maxHp + (level - 1) * 2),
    attack: Math.floor(base.attack + (level - 1) * 0.5),
    defense: Math.floor(base.defense + (level - 1) * 0.25),
    initiative: base.initiative,
    moveRange: base.moveRange,
  };
}

/**
 * Get monster count based on difficulty and player count.
 */
function getMonsterCount(
  difficulty: "easy" | "normal" | "hard",
  playerCount: number
): number {
  const base = { easy: 2, normal: 3, hard: 4 };
  return base[difficulty] + Math.floor(playerCount / 2);
}
