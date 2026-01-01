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
  findPath,
  getDistance,
  isAdjacent,
  hasLineOfSight,
  getReachablePositions,
  type GameAction,
  type GameState,
  type GameEvent,
  type Unit,
  type MapGeneratorOptions,
  type UnitGeneratorOptions,
  type Position,
} from "@rune-forge/simulation";
import { getDb } from "../db/index.js";
import { broadcastToSession } from "../ws/index.js";
import { getSession } from "./session.js";
import { createDelta, type GameSessionState, type StateDelta } from "./state.js";
import { getMonsterDefinition } from "./dm-commands.js";

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
 * @param sessionId The session ID
 * @param monsterTypes Optional array of monster type IDs to spawn (e.g., ["goblin", "orc"])
 */
export function initializeGame(sessionId: string, monsterTypes?: string[]): GameState {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const players = db.sessions.getPlayers(sessionId);

  // Generate map with session seed using proper options
  const mapOptions: MapGeneratorOptions = {
    seed: session.config.mapSeed,
    wallDensity: 0.12,
    name: `Session ${sessionId}`,
  };
  const map = generateMap(mapOptions);

  // Calculate total party size (players + NPCs)
  const npcCount = session.config.npcCount ?? 0;
  const npcClasses = session.config.npcClasses ?? [];
  const totalPartySize = players.length + npcCount;
  const spawnPositions = getPlayerSpawnPositions(totalPartySize);
  const playerMoveRange = session.config.playerMoveRange ?? 3;

  console.log(`[game] Using playerMoveRange: ${playerMoveRange} from DM config`);
  console.log(`[game] Party composition: ${players.length} players + ${npcCount} NPCs`);

  // Create player units from characters with DM-configured move range
  const playerUnits: Unit[] = [];

  for (let i = 0; i < players.length; i++) {
    const player = players[i]!;
    const character = db.characters.findById(player.characterId);

    if (!character) continue;

    const stats = calculateCharacterStats(character.class, character.level, playerMoveRange);
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

  // Create NPC party members
  const npcUnits: Unit[] = [];
  for (let i = 0; i < npcCount; i++) {
    const npcClass = npcClasses[i] ?? "warrior"; // Default to warrior if class not specified
    const npcName = getNpcName(npcClass, i);
    const npcLevel = 1; // NPCs start at level 1

    const stats = calculateCharacterStats(npcClass, npcLevel, playerMoveRange);
    const unit: Unit = {
      id: `npc-${i}`,
      type: "player", // NPCs are treated as players in combat
      name: npcName,
      position: spawnPositions[players.length + i]!, // Position after player units
      stats,
    };

    npcUnits.push(unit);
    console.log(`[game] Created NPC: ${npcName} (${npcClass}) at position`, unit.position);
  }

  let monsters: Unit[];

  // Check if specific monster types were requested
  if (monsterTypes && monsterTypes.length > 0) {
    // Create monsters based on specified types
    monsters = createMonstersFromTypes(monsterTypes, spawnPositions[0] ?? { x: 2, y: 2 }, session.config.mapSeed);
  } else {
    // Use DM-configured monster count and generate random monster types
    const monsterCount = session.config.monsterCount ?? getMonsterCount(session.config.difficulty, players.length);
    console.log(`[game] Using monsterCount: ${monsterCount} from DM config`);

    // Generate random monster types based on count
    const randomTypes = generateRandomMonsterTypes(monsterCount, session.config.mapSeed);
    console.log(`[game] Generated random monster types: ${randomTypes.join(", ")}`);

    monsters = createMonstersFromTypes(randomTypes, spawnPositions[0] ?? { x: 2, y: 2 }, session.config.mapSeed);
  }

  // Combine units (players, NPCs, then monsters)
  const units = [...playerUnits, ...npcUnits, ...monsters];

  // Create initial game state (combat not started yet)
  const initialState: GameState = {
    map,
    units,
    combat: {
      phase: "not_started",
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

  // Ensure unitId is set on all actions (simulation requires it)
  const actionWithUnit = { ...action, unitId: player.unitId };

  // Execute the action
  const oldState = session.gameState;
  const oldVersion = session.stateVersion;

  try {
    // executeAction throws on invalid actions
    const result = executeAction(actionWithUnit, session.gameState);

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

    // Handle turn change (check for turn_started event, not turn_changed)
    if (result.events.some((e) => e.type === "turn_started")) {
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
      error: error instanceof Error ? error.message : "EXECUTION_ERROR",
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
 * This broadcasts the current turn and executes monster AI if needed.
 */
export function handleTurnChange(session: GameSessionState): void {
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
    // Not a human player - check if it's an NPC or monster
    session.currentTurnUserId = null;

    const currentUnit = session.gameState.units.find(u => u.id === currentUnitId);
    if (currentUnit?.type === "player") {
      // NPC party member - execute friendly AI
      executeNpcTurn(session);
    } else {
      // Monster turn - execute hostile AI
      executeMonsterTurn(session);
    }
  }

  // Broadcast turn change (use round from CombatState)
  broadcastToSession(session.id, "turn_change", {
    currentUnitId,
    currentUserId: currentPlayer?.userId ?? null,
    round: session.gameState.combat.round,
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

  // Get current unit to provide unitId for end_turn action
  const currentUnitId = session.gameState.combat.turnState?.unitId;
  if (!currentUnitId) return;

  try {
    // Auto end turn - end_turn requires unitId
    const result = executeAction(
      { type: "end_turn", unitId: currentUnitId },
      session.gameState
    );

    session.gameState = result.state;
    session.stateVersion += 1;

    broadcastToSession(sessionId, "events", { events: result.events });
    broadcastToSession(sessionId, "turn_timeout", {});

    handleTurnChange(session);
  } catch (error) {
    console.error(`[game] Turn timeout execution error:`, error);
  }
}

/**
 * Execute monster AI turn.
 * Includes resilience measures to prevent game freezes.
 * Uses fast execution (50ms per monster) to handle many monsters quickly.
 */
function executeMonsterTurn(session: GameSessionState): void {
  // RESILIENCE: Check session state before proceeding
  if (!session || !session.gameState) {
    console.warn("[game] Monster turn aborted - no session/gameState");
    return;
  }

  const currentUnitId = session.gameState.combat.turnState?.unitId;
  if (!currentUnitId) {
    console.warn("[game] Monster turn aborted - no current unit");
    return;
  }

  // Get monster name for logging
  const currentMonster = session.gameState.units.find(u => u.id === currentUnitId);
  const monsterName = currentMonster?.name ?? currentUnitId;

  // Store session ID for use in timeout (in case session reference changes)
  const sessionId = session.id;

  // Fast AI: 50ms per monster to keep game moving
  const monsterTurnTimeout = setTimeout(() => {
    // RESILIENCE: Re-fetch session to ensure we have latest state
    const currentSession = getSession(sessionId);
    if (!currentSession || !currentSession.gameState) {
      console.warn(`[game] Monster turn timeout - session ${sessionId} no longer active`);
      return;
    }

    // RESILIENCE: Verify the unit is still the current turn unit
    const currentTurnUnitId = currentSession.gameState.combat.turnState?.unitId;
    if (currentTurnUnitId !== currentUnitId) {
      console.warn(`[game] Monster turn mismatch - expected ${currentUnitId}, got ${currentTurnUnitId}`);
      return;
    }

    try {
      // TODO: Implement actual monster AI (move toward player, attack if in range)
      // For now, just end turn
      const result = executeAction(
        { type: "end_turn", unitId: currentUnitId },
        currentSession.gameState
      );

      currentSession.gameState = result.state;
      currentSession.stateVersion += 1;

      broadcastToSession(sessionId, "events", { events: result.events });

      handleTurnChange(currentSession);
    } catch (error) {
      console.error(`[game] Monster turn execution error for ${monsterName}:`, error);

      // RESILIENCE: Try to recover by forcing turn advance
      try {
        console.log(`[game] Attempting turn recovery for session ${sessionId}`);
        forceAdvanceTurn(sessionId);
      } catch (recoveryError) {
        console.error(`[game] Turn recovery failed:`, recoveryError);
      }
    }
  }, 50); // Fast execution: 50ms per monster

  // Store timeout ID for cleanup (optional future use)
  (session as unknown as { monsterTurnTimeout?: ReturnType<typeof setTimeout> }).monsterTurnTimeout = monsterTurnTimeout;
}

/**
 * Execute NPC party member AI turn.
 * NPCs follow the player and attack nearby monsters.
 */
function executeNpcTurn(session: GameSessionState): void {
  if (!session || !session.gameState) {
    console.warn("[game] NPC turn aborted - no session/gameState");
    return;
  }

  const currentUnitId = session.gameState.combat.turnState?.unitId;
  if (!currentUnitId) {
    console.warn("[game] NPC turn aborted - no current unit");
    return;
  }

  const npc = session.gameState.units.find(u => u.id === currentUnitId);
  if (!npc) {
    console.warn("[game] NPC turn aborted - NPC not found");
    return;
  }

  const sessionId = session.id;

  // Fast AI: 100ms for NPC to think
  setTimeout(() => {
    const currentSession = getSession(sessionId);
    if (!currentSession || !currentSession.gameState) {
      console.warn(`[game] NPC turn timeout - session ${sessionId} no longer active`);
      return;
    }

    // Verify still this NPC's turn
    if (currentSession.gameState.combat.turnState?.unitId !== currentUnitId) {
      console.warn(`[game] NPC turn mismatch`);
      return;
    }

    try {
      // Find all living monsters
      const monsters = currentSession.gameState.units.filter(
        u => u.type === "monster" && u.stats.hp > 0
      );

      // Find all living players/NPCs for following
      const allies = currentSession.gameState.units.filter(
        u => u.type === "player" && u.stats.hp > 0 && u.id !== currentUnitId
      );

      const currentNpc = currentSession.gameState.units.find(u => u.id === currentUnitId)!;
      let state = currentSession.gameState;

      // NPC AI: move toward and attack enemies

      // Get NPC's attack range (default 1 for melee)
      const attackRange = currentNpc.attackRange ?? 1;
      const moveRange = currentNpc.moveRange ?? 3;

      // Step 1: Check if any monster is in attack range
      let targetMonster: Unit | null = null;
      for (const monster of monsters) {
        const distance = getDistance(currentNpc.position, monster.position);
        if (distance <= attackRange && hasLineOfSight(currentNpc.position, monster.position, state.map)) {
          targetMonster = monster;
          break;
        }
      }

      // Step 2: If no target in range, try to move closer
      if (!targetMonster && monsters.length > 0) {
        // Find nearest monster
        let nearestMonster: Unit | null = null;
        let nearestDistance = Infinity;
        for (const monster of monsters) {
          const distance = getDistance(currentNpc.position, monster.position);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestMonster = monster;
          }
        }

        if (nearestMonster) {
          // Find reachable positions
          const reachable = getReachablePositions(
            currentNpc.position,
            moveRange,
            state.map,
            state.units,
            currentUnitId
          );

          // Find the reachable position closest to the target
          let bestPosition: Position | null = null;
          let bestDistance = Infinity;
          for (const [posKey] of reachable) {
            const [x, y] = posKey.split(',').map(Number);
            const pos: Position = { x, y };
            const distToTarget = getDistance(pos, nearestMonster.position);
            if (distToTarget < bestDistance) {
              bestDistance = distToTarget;
              bestPosition = pos;
            }
          }

          // Move if we found a better position
          if (bestPosition && bestDistance < nearestDistance) {
            // Generate path from current position to best position
            const path = findPath(currentNpc.position, bestPosition, state.map, state.units, currentUnitId);
            if (path && path.length > 0) {
              const moveResult = executeAction(
                { type: "move", unitId: currentUnitId, path },
                state
              );
              state = moveResult.state;
              currentSession.gameState = state;
              currentSession.stateVersion += 1;
              broadcastToSession(sessionId, "events", { events: moveResult.events });

              // Update NPC position reference for attack check
              const movedNpc = state.units.find(u => u.id === currentUnitId);
              if (movedNpc) {
                // Check if we can now attack
                const distAfterMove = getDistance(movedNpc.position, nearestMonster.position);
                if (distAfterMove <= attackRange && hasLineOfSight(movedNpc.position, nearestMonster.position, state.map)) {
                  targetMonster = nearestMonster;
                }
              }
            }
          }
        }
      }

      // Step 3: Attack if we have a target
      if (targetMonster) {
        const attackResult = executeAction(
          { type: "attack", unitId: currentUnitId, targetId: targetMonster.id },
          state
        );
        state = attackResult.state;
        currentSession.gameState = state;
        currentSession.stateVersion += 1;
        broadcastToSession(sessionId, "events", { events: attackResult.events });
      }

      // Step 4: End turn
      const endResult = executeAction(
        { type: "end_turn", unitId: currentUnitId },
        state
      );
      currentSession.gameState = endResult.state;
      currentSession.stateVersion += 1;
      broadcastToSession(sessionId, "events", { events: endResult.events });

      handleTurnChange(currentSession);
    } catch (error) {
      console.error(`[game] NPC turn execution error:`, error);

      // Recovery: force end turn
      try {
        forceAdvanceTurn(sessionId);
      } catch (recoveryError) {
        console.error(`[game] NPC turn recovery failed:`, recoveryError);
      }
    }
  }, 100);
}

/**
 * Force advance the turn when normal turn processing fails.
 * This is a recovery mechanism to prevent game freezes.
 */
function forceAdvanceTurn(sessionId: string): void {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session || !session.gameState) {
    console.warn(`[game] forceAdvanceTurn - session ${sessionId} not found`);
    return;
  }

  const combat = session.gameState.combat;

  // Find next valid turn index
  let nextIndex = combat.currentTurnIndex + 1;
  if (nextIndex >= combat.initiativeOrder.length) {
    nextIndex = 0;
  }

  // Update combat state to advance turn
  const newCombat = {
    ...combat,
    currentTurnIndex: nextIndex,
    turnState: null, // Will be re-initialized by handleTurnChange
    round: nextIndex === 0 ? combat.round + 1 : combat.round,
  };

  session.gameState = {
    ...session.gameState,
    combat: newCombat,
  };
  session.stateVersion += 1;

  db.sessions.updateGameState(sessionId, session.gameState, session.stateVersion);

  console.log(`[game] Force advanced turn in session ${sessionId} to index ${nextIndex}`);

  // Re-trigger turn handling
  handleTurnChange(session);
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
 * @param characterClass The character's class
 * @param level The character's level
 * @param moveRangeOverride Optional DM override for move range
 */
function calculateCharacterStats(
  characterClass: string,
  level: number,
  moveRangeOverride?: number
): Unit["stats"] {
  // Base stats for each class (matching characters.ts definitions on client)
  const baseStats: Record<string, { hp: number; maxHp: number; attack: number; defense: number; initiative: number; moveRange: number; attackRange: number }> = {
    // Database classes (synced characters)
    warrior: { hp: 12, maxHp: 12, attack: 4, defense: 3, initiative: 2, moveRange: 3, attackRange: 1 },
    ranger: { hp: 10, maxHp: 10, attack: 3, defense: 2, initiative: 4, moveRange: 4, attackRange: 3 },
    mage: { hp: 8, maxHp: 8, attack: 5, defense: 1, initiative: 3, moveRange: 3, attackRange: 2 },
    rogue: { hp: 9, maxHp: 9, attack: 3, defense: 2, initiative: 5, moveRange: 5, attackRange: 1 },
    // Extended classes from characters.ts (for NPC party members)
    fighter: { hp: 60, maxHp: 60, attack: 12, defense: 8, initiative: 10, moveRange: 4, attackRange: 1 },
    cleric: { hp: 45, maxHp: 45, attack: 8, defense: 10, initiative: 8, moveRange: 3, attackRange: 1 },
    thief: { hp: 35, maxHp: 35, attack: 10, defense: 5, initiative: 15, moveRange: 5, attackRange: 1 },
    elf: { hp: 40, maxHp: 40, attack: 10, defense: 6, initiative: 14, moveRange: 4, attackRange: 2 },
    dwarf: { hp: 55, maxHp: 55, attack: 11, defense: 12, initiative: 6, moveRange: 3, attackRange: 1 },
  };

  const base = baseStats[characterClass.toLowerCase()] ?? baseStats.warrior!;
  const scaledMaxHp = Math.floor(base.maxHp + (level - 1) * 2);

  // Use DM override for moveRange if provided
  const finalMoveRange = moveRangeOverride ?? base.moveRange;

  return {
    hp: scaledMaxHp,
    maxHp: scaledMaxHp,
    attack: Math.floor(base.attack + (level - 1) * 0.5),
    defense: Math.floor(base.defense + (level - 1) * 0.25),
    initiative: base.initiative,
    moveRange: finalMoveRange,
    attackRange: base.attackRange,
  };
}

/**
 * Generate a name for an NPC based on their class.
 * Format: "Name the Class" for client to parse class from name.
 */
function getNpcName(npcClass: string, index: number): string {
  const classNames: Record<string, string[]> = {
    warrior: ["Grom", "Thorne", "Baldric", "Kael", "Dorn", "Viktor", "Marcus", "Roland"],
    fighter: ["Grom", "Thorne", "Baldric", "Kael", "Dorn", "Viktor", "Marcus", "Roland"],
    ranger: ["Elara", "Sylvan", "Fern", "Ash", "Brook", "Rowan", "Wren", "Mira"],
    elf: ["Aelindra", "Elowen", "Thalion", "Faenor", "Lirael", "Caelum", "Silvara", "Lysander"],
    mage: ["Zephyr", "Nyx", "Orion", "Luna", "Sage", "Theron", "Ada", "Finn"],
    rogue: ["Shadow", "Dex", "Raven", "Sly", "Phantom", "Vex", "Whisper", "Kira"],
    thief: ["Shadow", "Dex", "Raven", "Sly", "Phantom", "Vex", "Whisper", "Kira"],
    cleric: ["Aldric", "Mira", "Kael", "Theron", "Bram", "Vera", "Solara", "Blessed"],
    dwarf: ["Brogar", "Durin", "Thorin", "Gimrik", "Dwalin", "Balin", "Oin", "Gloin"],
  };

  // Format class name for display (capitalize first letter)
  const classDisplay = npcClass.charAt(0).toUpperCase() + npcClass.slice(1).toLowerCase();

  const names = classNames[npcClass.toLowerCase()] ?? classNames.warrior!;
  const baseName = names[index % names.length]!;

  // Return "Name the Class" format for client parsing
  return `${baseName} the ${classDisplay}`;
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

/**
 * Generate random monster types based on count and seed.
 * Provides variety by selecting from available monster types.
 */
function generateRandomMonsterTypes(count: number, seed: number): string[] {
  // Available monster types (from dm-commands.ts MONSTER_DEFINITIONS)
  const availableTypes = [
    "goblin",
    "goblin_archer",
    "orc",
    "skeleton",
    "skeleton_archer",
    "wolf",
    "orc_warlord", // Rare/strong
    "troll",       // Rare/strong
  ];

  // Seeded random for deterministic results
  let s = seed;
  const seededRandom = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  const types: string[] = [];

  // Weight distribution: common monsters more likely
  const commonTypes = availableTypes.slice(0, 6);  // Regular monsters
  const rareTypes = availableTypes.slice(6);       // Strong monsters (orc_warlord, troll)

  for (let i = 0; i < count; i++) {
    const roll = seededRandom();

    // 85% common, 15% rare
    if (roll < 0.85 || rareTypes.length === 0) {
      const idx = Math.floor(seededRandom() * commonTypes.length);
      types.push(commonTypes[idx]!);
    } else {
      const idx = Math.floor(seededRandom() * rareTypes.length);
      types.push(rareTypes[idx]!);
    }
  }

  return types;
}

/**
 * Create monsters from an array of monster type IDs.
 * Positions them spread across the map away from the player spawn.
 */
function createMonstersFromTypes(
  monsterTypes: string[],
  playerSpawn: { x: number; y: number },
  seed: number
): Unit[] {
  const monsters: Unit[] = [];

  // Generate positions dynamically to support many monsters
  // Spread monsters across the map with good distribution
  const generateSpawnPositions = (count: number): Array<{ x: number; y: number }> => {
    const positions: Array<{ x: number; y: number }> = [];
    const usedPositions = new Set<string>();

    // Use seeded random for deterministic positioning
    let s = seed;
    const seededRandom = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };

    // Define map bounds (map is typically 20x20)
    const mapSize = 20;
    const minDistFromPlayer = 5; // Minimum distance from player spawn
    const minDistBetweenMonsters = 2; // Minimum spacing between monsters

    // Helper to check distance from all placed monsters
    const isFarEnoughFromOthers = (x: number, y: number): boolean => {
      for (const pos of positions) {
        const dx = x - pos.x;
        const dy = y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDistBetweenMonsters) return false;
      }
      return true;
    };

    // Try to place monsters with good spacing
    const maxAttempts = count * 50;
    for (let attempt = 0; attempt < maxAttempts && positions.length < count; attempt++) {
      const x = Math.floor(seededRandom() * (mapSize - 4)) + 2; // 2 to 17
      const y = Math.floor(seededRandom() * (mapSize - 4)) + 2; // 2 to 17

      const posKey = `${x},${y}`;
      if (usedPositions.has(posKey)) continue;

      // Check distance from player spawn
      const dx = x - playerSpawn.x;
      const dy = y - playerSpawn.y;
      const distFromPlayer = Math.sqrt(dx * dx + dy * dy);

      if (distFromPlayer >= minDistFromPlayer && isFarEnoughFromOthers(x, y)) {
        usedPositions.add(posKey);
        positions.push({ x, y });
      }
    }

    // If we couldn't place all monsters with ideal spacing, reduce constraints
    if (positions.length < count) {
      console.log(`[game] Could only place ${positions.length}/${count} monsters with ideal spacing, filling rest`);
      for (let attempt = 0; positions.length < count && attempt < count * 20; attempt++) {
        const x = Math.floor(seededRandom() * (mapSize - 2)) + 1;
        const y = Math.floor(seededRandom() * (mapSize - 2)) + 1;
        const posKey = `${x},${y}`;

        if (!usedPositions.has(posKey)) {
          const dx = x - playerSpawn.x;
          const dy = y - playerSpawn.y;
          if (Math.sqrt(dx * dx + dy * dy) >= 3) { // Reduced minimum distance
            usedPositions.add(posKey);
            positions.push({ x, y });
          }
        }
      }
    }

    return positions;
  };

  const spawnPositions = generateSpawnPositions(monsterTypes.length);

  for (let i = 0; i < monsterTypes.length; i++) {
    const monsterType = monsterTypes[i]!;
    const monsterDef = getMonsterDefinition(monsterType);

    if (!monsterDef) {
      console.warn(`[game] Unknown monster type: ${monsterType}`);
      continue;
    }

    const position = spawnPositions[i]!;

    const monster: Unit = {
      id: `monster-${i}-${seed}`,
      type: "monster",
      name: monsterDef.name,
      position: { ...position },
      stats: { ...monsterDef.stats },
    };

    monsters.push(monster);
  }

  console.log(`[game] Created ${monsters.length} monsters from types: ${monsterTypes.join(", ")}`);

  return monsters;
}
