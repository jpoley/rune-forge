/**
 * Game Action Executor
 *
 * Server-side execution of game actions with validation.
 */

import {
  executeAction,
  generateMap,
  generateUnits,
  generateNPCs,
  startCombat,
  findPath,
  hasLineOfSight,
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
  const map = generateMap({ seed: session.config.mapSeed });

  // Create player units from characters
  const playerUnits: Unit[] = [];
  const spawnPositions = getPlayerSpawnPositions(players.length);

  // DM-configurable move range (undefined means use class default)
  const dmMoveRange = session.config.playerMoveRange;

  for (let i = 0; i < players.length; i++) {
    const player = players[i]!;
    const character = db.characters.findById(player.characterId);

    if (!character) continue;

    const stats = calculateCharacterStats(character.class, character.level, dmMoveRange);
    const unit: Unit = {
      id: `player-${player.userId}`,
      type: "player",
      name: character.name,
      position: spawnPositions[i]!,
      stats,
    };

    playerUnits.push(unit);

    // Assign unit ID to player in database
    db.sessions.assignUnitId(sessionId, player.userId, unit.id);
  }

  // Generate monsters - use DM-configured count, fallback to difficulty-based
  const monsterCount = session.config.monsterCount ?? getMonsterCount(session.config.difficulty, players.length);
  const generatedUnits = generateUnits({
    seed: session.config.mapSeed,
    monsterCount,
    playerStart: { x: 0, y: 0 },
  });
  // Filter out the auto-generated player, keep only monsters
  const monsters = generatedUnits.filter(u => u.type === "monster");

  // Generate NPC companions - use specific classes if provided, otherwise random
  const npcClasses = session.config.npcClasses;
  const npcCount = npcClasses?.length ?? session.config.npcCount ?? 2;
  const npcs = npcCount > 0 ? generateNPCs({
    seed: session.config.mapSeed,
    playerStart: { x: 0, y: 0 },
    count: Math.min(npcCount, 7),
    classes: npcClasses,
    moveRange: dmMoveRange, // Use DM-configured move range for NPCs too
  }) : [];

  // Combine units
  const units = [...playerUnits, ...npcs, ...monsters];

  // Create initial game state (combat not started yet)
  const initialState: GameState = {
    map,
    units,
    combat: {
      phase: "setup",
      round: 0,
      initiativeOrder: [],
      currentTurnIndex: 0,
      turnState: null,
    },
    turnHistory: [],
    lootDrops: [],
    playerInventory: {
      gold: 0,
      silver: 0,
      weapons: [],
      equippedWeaponId: null,
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
    // executeAction throws on validation failure, returns { state, events } on success
    const result = executeAction(action, session.gameState);

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

    // Handle turn change when turn ends
    if (result.events.some((e) => e.type === "turn_ended" || e.type === "turn_started")) {
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
export function handleTurnChange(session: GameSessionState): void {
  if (!session.gameState) return;

  const currentUnitId = session.gameState.combat.turnState?.unitId;
  if (!currentUnitId) return;

  // Get the current unit from game state
  const currentUnit = session.gameState.units.find((u) => u.id === currentUnitId);
  if (!currentUnit) {
    console.error(`[game] Turn change but unit ${currentUnitId} not found`);
    return;
  }

  // Find the player whose turn it is (only for type: "player" units)
  const db = getDb();
  const players = db.sessions.getPlayers(session.id);
  const currentPlayer = currentUnit.type === "player"
    ? players.find((p) => p.unitId === currentUnitId)
    : null;

  if (currentUnit.type === "player" && currentPlayer) {
    // Human player's turn
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
  } else if (currentUnit.type === "npc") {
    // NPC turn - execute NPC AI (friendly to player)
    session.currentTurnUserId = null;
    console.log(`[game] NPC ${currentUnit.name} (${currentUnitId}) taking turn`);
    executeNpcTurn(session);
  } else if (currentUnit.type === "monster") {
    // Monster turn - execute Monster AI
    session.currentTurnUserId = null;
    console.log(`[game] Monster ${currentUnit.name} (${currentUnitId}) taking turn`);
    executeMonsterTurn(session);
  }

  // Broadcast turn change
  broadcastToSession(session.id, "turn_change", {
    currentUnitId,
    currentUserId: currentPlayer?.userId ?? null,
    turnNumber: session.gameState.combat.turnNumber,
    isPlayerTurn: currentUnit.type === "player",
  });
}

/**
 * Handle turn timeout.
 */
function handleTurnTimeout(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session || !session.gameState) return;

  console.log(`[game] Turn timeout for session ${sessionId}`);

  const currentUnitId = session.gameState.combat.turnState?.unitId;
  if (!currentUnitId) {
    console.error(`[game] Turn timeout but no current unit`);
    return;
  }

  // Auto end turn
  try {
    const oldState = session.gameState;
    const oldVersion = session.stateVersion;
    const result = executeAction({ type: "end_turn", unitId: currentUnitId }, session.gameState);

    session.gameState = result.state;
    session.stateVersion += 1;

    // Create delta for client sync
    const delta = createDelta(oldState, result.state, oldVersion, session.stateVersion);

    broadcastToSession(sessionId, "events", { events: result.events });
    broadcastToSession(sessionId, "state_delta", { delta });
    broadcastToSession(sessionId, "turn_timeout", {});

    handleTurnChange(session);
  } catch (error) {
    console.error(`[game] Turn timeout execution error:`, error);
  }
}

/**
 * Calculate Manhattan distance between two positions.
 */
function getDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Execute NPC AI turn (friendly units).
 * NPCs are controlled by AI that follows players and attacks enemies.
 */
export function executeNpcTurn(session: GameSessionState): void {
  if (!session.gameState) return;

  const currentUnitId = session.gameState.combat.turnState?.unitId;
  if (!currentUnitId) {
    console.error(`[game] NPC turn but no current unit`);
    return;
  }

  const npc = session.gameState.units.find((u) => u.id === currentUnitId);
  if (!npc) {
    console.error(`[game] NPC ${currentUnitId} not found`);
    return;
  }

  // Find enemies (monsters) and allies (players)
  const enemies = session.gameState.units.filter((u) => u.type === "monster" && u.stats.hp > 0);
  const players = session.gameState.units.filter((u) => u.type === "player" && u.stats.hp > 0);

  // Find closest enemy within attack range AND with line of sight
  const attackRange = npc.stats.attackRange ?? 1;
  const enemiesInRange = enemies.filter((e) => {
    const dist = getDistance(npc.position, e.position);
    if (dist > attackRange) return false;
    // Must have line of sight to attack
    return hasLineOfSight(npc.position, e.position, session.gameState!.map);
  });

  // Find priority targets:
  // 1. Enemies that attacked this NPC (retaliation)
  // 2. Enemies that the player most recently attacked (assist)
  const priorityTargetIds = new Set<string>();

  // Look at recent events to find priority targets
  const recentEvents = session.gameState.turnHistory.slice(-20); // Last 20 events
  for (const event of recentEvents) {
    if (event.type === "unit_attacked") {
      const attackEvent = event as { attackerId: string; targetId: string };
      // If something attacked this NPC, prioritize attacking it back
      if (attackEvent.targetId === npc.id) {
        priorityTargetIds.add(attackEvent.attackerId);
      }
      // If a player attacked something, NPC should help attack it
      const attacker = session.gameState.units.find((u) => u.id === attackEvent.attackerId);
      if (attacker?.type === "player") {
        priorityTargetIds.add(attackEvent.targetId);
      }
    }
  }

  // Sort enemies in range by priority
  const sortedEnemiesInRange = [...enemiesInRange].sort((a, b) => {
    const aIsPriority = priorityTargetIds.has(a.id) ? 1 : 0;
    const bIsPriority = priorityTargetIds.has(b.id) ? 1 : 0;
    return bIsPriority - aIsPriority; // Priority targets first
  });

  setTimeout(async () => {
    if (!session.gameState) return;

    const unitId = session.gameState.combat.turnState?.unitId;
    if (!unitId) {
      console.error(`[game] NPC turn ended but no current unit`);
      return;
    }

    try {
      let oldState = session.gameState;
      let oldVersion = session.stateVersion;

      // 1. Attack if enemy in range (prioritize player's targets and retaliation)
      if (sortedEnemiesInRange.length > 0) {
        const target = sortedEnemiesInRange[0]!;
        const isPriority = priorityTargetIds.has(target.id);
        console.log(`[game] NPC ${npc.name} attacking ${target.name}${isPriority ? " (priority target)" : ""}`);

        const attackResult = executeAction(
          { type: "attack", unitId, targetId: target.id },
          session.gameState
        );
        session.gameState = attackResult.state;
        session.stateVersion += 1;

        const attackDelta = createDelta(oldState, attackResult.state, oldVersion, session.stateVersion);
        broadcastToSession(session.id, "events", { events: attackResult.events });
        broadcastToSession(session.id, "state_delta", { delta: attackDelta });

        oldState = session.gameState;
        oldVersion = session.stateVersion;
      }
      // 2. Move toward priority target or closest player
      else if ((enemies.length > 0 || players.length > 0) && (session.gameState.combat.turnState?.movementRemaining ?? 0) > 0) {
        const movementRemaining = session.gameState.combat.turnState?.movementRemaining ?? 0;
        const FOLLOW_DISTANCE = 2; // NPCs try to stay within 2 tiles of player

        // First, check if there's a priority target to move toward
        let moveTarget: { position: { x: number; y: number }; name: string; type: "enemy" | "player" } | null = null;

        // Find priority enemies not in range
        for (const targetId of priorityTargetIds) {
          const enemy = enemies.find((e) => e.id === targetId);
          if (enemy && !sortedEnemiesInRange.includes(enemy)) {
            moveTarget = { position: enemy.position, name: enemy.name, type: "enemy" };
            break;
          }
        }

        // If no priority target, stay close to player
        if (!moveTarget && players.length > 0) {
          let closestPlayer = players[0]!;
          let closestDist = getDistance(npc.position, closestPlayer.position);
          for (const player of players) {
            const dist = getDistance(npc.position, player.position);
            if (dist < closestDist) {
              closestDist = dist;
              closestPlayer = player;
            }
          }
          // Only move toward player if not close enough
          if (closestDist > FOLLOW_DISTANCE) {
            moveTarget = { position: closestPlayer.position, name: closestPlayer.name, type: "player" };
          }
        }

        if (moveTarget) {
          // Find adjacent tiles to the target that are walkable
          const adjacentTiles = [
            { x: moveTarget.position.x + 1, y: moveTarget.position.y },
            { x: moveTarget.position.x - 1, y: moveTarget.position.y },
            { x: moveTarget.position.x, y: moveTarget.position.y + 1 },
            { x: moveTarget.position.x, y: moveTarget.position.y - 1 },
          ].filter((pos) => {
            const tile = session.gameState?.map.getTile(pos.x, pos.y);
            if (!tile?.walkable) return false;
            const occupied = session.gameState?.units.some(
              (u) => u.stats.hp > 0 && u.position.x === pos.x && u.position.y === pos.y
            );
            return !occupied;
          });

          // Find the best path to any adjacent tile
          let bestPath: { x: number; y: number }[] | null = null;
          let bestPathLength = Infinity;

          for (const target of adjacentTiles) {
            const path = findPath(
              npc.position,
              target,
              session.gameState.map,
              session.gameState.units,
              npc.id
            );
            if (path && path.length > 1 && path.length < bestPathLength) {
              bestPath = path;
              bestPathLength = path.length;
            }
          }

          if (bestPath && bestPath.length > 1) {
            // Truncate path to movement remaining (path includes start, so length-1 = moves)
            const maxMoves = movementRemaining;
            const truncatedPath = bestPath.slice(0, maxMoves + 1);

            console.log(`[game] NPC ${npc.name} moving toward ${moveTarget.type === "enemy" ? "enemy " + moveTarget.name : "player"}: ${truncatedPath.length - 1} tiles (of ${bestPath.length - 1} total)`);

            try {
              const moveResult = executeAction(
                { type: "move", unitId, path: truncatedPath },
                session.gameState
              );
              session.gameState = moveResult.state;
              session.stateVersion += 1;

              const moveDelta = createDelta(oldState, moveResult.state, oldVersion, session.stateVersion);
              broadcastToSession(session.id, "events", { events: moveResult.events });
              broadcastToSession(session.id, "state_delta", { delta: moveDelta });

              oldState = session.gameState;
              oldVersion = session.stateVersion;
            } catch (moveError) {
              console.log(`[game] NPC ${npc.name} move failed:`, moveError);
            }
          } else {
            console.log(`[game] NPC ${npc.name} no valid path to ${moveTarget.type === "enemy" ? "enemy" : "player"}`);
          }
        }
      }

      // 3. Collect any loot at NPC's position (NPCs collect for the player)
      const currentNpc = session.gameState.units.find((u) => u.id === unitId);
      if (currentNpc) {
        const lootAtPosition = session.gameState.lootDrops.find(
          (l) => l.position.x === currentNpc.position.x && l.position.y === currentNpc.position.y
        );
        if (lootAtPosition) {
          console.log(`[game] NPC ${npc.name} collecting loot at position`);
          try {
            const collectResult = executeAction(
              { type: "collect_loot", unitId, lootDropId: lootAtPosition.id },
              session.gameState
            );
            session.gameState = collectResult.state;
            session.stateVersion += 1;

            const collectDelta = createDelta(oldState, collectResult.state, oldVersion, session.stateVersion);
            broadcastToSession(session.id, "events", { events: collectResult.events });
            broadcastToSession(session.id, "state_delta", { delta: collectDelta });

            oldState = session.gameState;
            oldVersion = session.stateVersion;
          } catch (collectError) {
            console.log(`[game] NPC ${npc.name} loot collection failed:`, collectError);
          }
        }
      }

      // 4. End turn
      const endResult = executeAction({ type: "end_turn", unitId }, session.gameState);
      session.gameState = endResult.state;
      session.stateVersion += 1;

      const endDelta = createDelta(oldState, endResult.state, oldVersion, session.stateVersion);
      broadcastToSession(session.id, "events", { events: endResult.events });
      broadcastToSession(session.id, "state_delta", { delta: endDelta });

      handleTurnChange(session);
    } catch (error) {
      console.error(`[game] NPC turn execution error:`, error);
    }
  }, 500);
}

/**
 * Execute monster AI turn.
 * Monsters attack players and NPCs, moving toward them if not in range.
 */
export function executeMonsterTurn(session: GameSessionState): void {
  if (!session.gameState) return;

  const currentUnitId = session.gameState.combat.turnState?.unitId;
  if (!currentUnitId) {
    console.error(`[game] Monster turn but no current unit`);
    return;
  }

  const monster = session.gameState.units.find((u) => u.id === currentUnitId);
  if (!monster) {
    console.error(`[game] Monster ${currentUnitId} not found`);
    return;
  }

  // Enemies are players and NPCs
  const enemies = session.gameState.units.filter(
    (u) => (u.type === "player" || u.type === "npc") && u.stats.hp > 0
  );

  const attackRange = monster.stats.attackRange ?? 1;
  const enemiesInRange = enemies.filter((e) => {
    const dist = getDistance(monster.position, e.position);
    if (dist > attackRange) return false;
    // Must have line of sight to attack
    return hasLineOfSight(monster.position, e.position, session.gameState!.map);
  });

  setTimeout(async () => {
    if (!session.gameState) return;

    const unitId = session.gameState.combat.turnState?.unitId;
    if (!unitId) {
      console.error(`[game] Monster turn ended but no current unit`);
      return;
    }

    try {
      let oldState = session.gameState;
      let oldVersion = session.stateVersion;

      // 1. Attack if player/NPC in range
      if (
        enemiesInRange.length > 0 &&
        !session.gameState.combat.turnState?.hasActed
      ) {
        const target = enemiesInRange[0]!;
        console.log(`[game] Monster ${monster.name} attacking ${target.name}`);

        try {
          const attackResult = executeAction(
            { type: "attack", unitId, targetId: target.id },
            session.gameState
          );
          session.gameState = attackResult.state;
          session.stateVersion += 1;

          const attackDelta = createDelta(oldState, attackResult.state, oldVersion, session.stateVersion);
          broadcastToSession(session.id, "events", { events: attackResult.events });
          broadcastToSession(session.id, "state_delta", { delta: attackDelta });

          oldState = session.gameState;
          oldVersion = session.stateVersion;
        } catch (attackError) {
          console.log(`[game] Monster ${monster.name} attack failed:`, attackError);
        }
      }
      // 2. Move toward closest player/NPC if not in range
      else if (enemies.length > 0 && (session.gameState.combat.turnState?.movementRemaining ?? 0) > 0) {
        const movementRemaining = session.gameState.combat.turnState?.movementRemaining ?? 0;

        // Find closest enemy
        let closestEnemy = enemies[0]!;
        let closestDist = getDistance(monster.position, closestEnemy.position);
        for (const enemy of enemies) {
          const dist = getDistance(monster.position, enemy.position);
          if (dist < closestDist) {
            closestDist = dist;
            closestEnemy = enemy;
          }
        }

        // If not in attack range, try to move closer
        if (closestDist > attackRange) {
          // Find adjacent tiles to the enemy that are walkable
          const adjacentTiles = [
            { x: closestEnemy.position.x + 1, y: closestEnemy.position.y },
            { x: closestEnemy.position.x - 1, y: closestEnemy.position.y },
            { x: closestEnemy.position.x, y: closestEnemy.position.y + 1 },
            { x: closestEnemy.position.x, y: closestEnemy.position.y - 1 },
          ].filter((pos) => {
            const tile = session.gameState?.map.getTile(pos.x, pos.y);
            if (!tile?.walkable) return false;
            const occupied = session.gameState?.units.some(
              (u) => u.stats.hp > 0 && u.position.x === pos.x && u.position.y === pos.y
            );
            return !occupied;
          });

          // Find the best path to any adjacent tile
          let bestPath: { x: number; y: number }[] | null = null;
          let bestPathLength = Infinity;

          for (const target of adjacentTiles) {
            const path = findPath(
              monster.position,
              target,
              session.gameState.map,
              session.gameState.units,
              monster.id
            );
            if (path && path.length > 1 && path.length < bestPathLength) {
              bestPath = path;
              bestPathLength = path.length;
            }
          }

          if (bestPath && bestPath.length > 1) {
            // Truncate path to movement remaining
            const maxMoves = movementRemaining;
            const truncatedPath = bestPath.slice(0, maxMoves + 1);

            console.log(`[game] Monster ${monster.name} moving toward enemy: ${truncatedPath.length - 1} tiles (of ${bestPath.length - 1} total)`);

            try {
              const moveResult = executeAction(
                { type: "move", unitId, path: truncatedPath },
                session.gameState
              );
              session.gameState = moveResult.state;
              session.stateVersion += 1;

              const moveDelta = createDelta(oldState, moveResult.state, oldVersion, session.stateVersion);
              broadcastToSession(session.id, "events", { events: moveResult.events });
              broadcastToSession(session.id, "state_delta", { delta: moveDelta });

              oldState = session.gameState;
              oldVersion = session.stateVersion;
            } catch (moveError) {
              console.log(`[game] Monster ${monster.name} move failed:`, moveError);
            }
          }
        }
      }

      // 3. End turn
      const endResult = executeAction({ type: "end_turn", unitId }, session.gameState);
      session.gameState = endResult.state;
      session.stateVersion += 1;

      const endDelta = createDelta(oldState, endResult.state, oldVersion, session.stateVersion);
      broadcastToSession(session.id, "events", { events: endResult.events });
      broadcastToSession(session.id, "state_delta", { delta: endDelta });

      handleTurnChange(session);
    } catch (error) {
      console.error(`[game] Monster turn execution error:`, error);
    }
  }, 500);
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
 * @param overrideMoveRange - Optional override for move range (DM setting)
 */
function calculateCharacterStats(
  characterClass: string,
  level: number,
  overrideMoveRange?: number
): Unit["stats"] {
  const baseStats: Record<string, Omit<Unit["stats"], "hp">> = {
    warrior: { maxHp: 12, attack: 4, defense: 3, initiative: 2, moveRange: 3, attackRange: 1 },
    ranger: { maxHp: 10, attack: 3, defense: 2, initiative: 4, moveRange: 4, attackRange: 5 },
    mage: { maxHp: 8, attack: 5, defense: 1, initiative: 3, moveRange: 3, attackRange: 4 },
    rogue: { maxHp: 9, attack: 3, defense: 2, initiative: 5, moveRange: 5, attackRange: 1 },
  };

  const base = baseStats[characterClass] ?? baseStats.warrior!;
  const maxHp = Math.floor(base.maxHp + (level - 1) * 2);

  return {
    hp: maxHp, // Start at full HP
    maxHp,
    attack: Math.floor(base.attack + (level - 1) * 0.5),
    defense: Math.floor(base.defense + (level - 1) * 0.25),
    initiative: base.initiative,
    moveRange: overrideMoveRange ?? base.moveRange,
    attackRange: base.attackRange,
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
