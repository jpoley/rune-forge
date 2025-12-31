/**
 * DM Commands Implementation
 *
 * Server-side implementation of DM (Dungeon Master) commands
 * that modify game state directly.
 */

import type { GameState, Unit, LootItem, Position } from "@rune-forge/simulation";
import { getDb } from "../db/index.js";
import { getSession } from "./session.js";
import { broadcastToSession } from "../ws/index.js";
import type { GameSessionState } from "./state.js";

/**
 * Result of a DM command execution.
 */
export interface DMCommandResult {
  success: boolean;
  error?: string;
  state?: GameState;
}

/**
 * Grant gold to a player's inventory.
 */
export function grantGold(
  session: GameSessionState,
  targetUserId: string,
  amount: number
): DMCommandResult {
  if (!session.gameState) {
    return { success: false, error: "GAME_NOT_STARTED" };
  }

  if (amount <= 0) {
    return { success: false, error: "INVALID_AMOUNT" };
  }

  // Verify target is in the game
  const db = getDb();
  const player = db.sessions.getPlayer(session.id, targetUserId);
  if (!player) {
    return { success: false, error: "PLAYER_NOT_FOUND" };
  }

  // Update game state - add gold to shared inventory
  const newInventory = {
    ...session.gameState.playerInventory,
    gold: session.gameState.playerInventory.gold + amount,
  };

  const newState: GameState = {
    ...session.gameState,
    playerInventory: newInventory,
  };

  session.gameState = newState;
  session.stateVersion += 1;

  // Persist and broadcast
  db.sessions.updateGameState(session.id, newState, session.stateVersion);

  broadcastToSession(session.id, "dm_event", {
    type: "gold_granted",
    targetUserId,
    amount,
    newTotal: newInventory.gold,
  });

  console.log(`[dm] Granted ${amount} gold to ${targetUserId} in session ${session.id}`);

  return { success: true, state: newState };
}

/**
 * Grant XP to a player's character.
 */
export function grantXp(
  session: GameSessionState,
  targetUserId: string,
  amount: number
): DMCommandResult {
  if (!session.gameState) {
    return { success: false, error: "GAME_NOT_STARTED" };
  }

  if (amount <= 0) {
    return { success: false, error: "INVALID_AMOUNT" };
  }

  // Verify target is in the game
  const db = getDb();
  const player = db.sessions.getPlayer(session.id, targetUserId);
  if (!player || !player.characterId) {
    return { success: false, error: "PLAYER_NOT_FOUND" };
  }

  // Grant XP to the character via database
  const character = db.characters.findById(player.characterId);
  if (!character) {
    return { success: false, error: "CHARACTER_NOT_FOUND" };
  }

  const newXp = character.xp + amount;
  const newLevel = calculateLevel(newXp);

  db.characters.updateProgression(player.characterId, {
    xp: newXp,
    level: newLevel,
  });

  // Broadcast XP gain
  broadcastToSession(session.id, "dm_event", {
    type: "xp_granted",
    targetUserId,
    amount,
    newXp,
    newLevel,
    leveledUp: newLevel > character.level,
  });

  console.log(`[dm] Granted ${amount} XP to ${targetUserId} in session ${session.id}`);

  return { success: true };
}

/**
 * Grant a weapon to a player's inventory.
 */
export function grantWeapon(
  session: GameSessionState,
  targetUserId: string,
  weaponId: string
): DMCommandResult {
  if (!session.gameState) {
    return { success: false, error: "GAME_NOT_STARTED" };
  }

  // Verify target is in the game
  const db = getDb();
  const player = db.sessions.getPlayer(session.id, targetUserId);
  if (!player) {
    return { success: false, error: "PLAYER_NOT_FOUND" };
  }

  // Get weapon definition from predefined list
  const weapon = getWeaponDefinition(weaponId);
  if (!weapon) {
    return { success: false, error: "WEAPON_NOT_FOUND" };
  }

  // Create unique weapon instance
  const weaponItem: LootItem = {
    ...weapon,
    id: `${weaponId}-${Date.now()}`,
  };

  // Update inventory
  const newInventory = {
    ...session.gameState.playerInventory,
    weapons: [...session.gameState.playerInventory.weapons, weaponItem],
  };

  const newState: GameState = {
    ...session.gameState,
    playerInventory: newInventory,
  };

  session.gameState = newState;
  session.stateVersion += 1;

  // Persist and broadcast
  db.sessions.updateGameState(session.id, newState, session.stateVersion);

  broadcastToSession(session.id, "dm_event", {
    type: "weapon_granted",
    targetUserId,
    weapon: weaponItem,
  });

  console.log(`[dm] Granted weapon ${weaponId} to ${targetUserId} in session ${session.id}`);

  return { success: true, state: newState };
}

/**
 * Spawn a monster at a position.
 */
export function spawnMonster(
  session: GameSessionState,
  position: Position,
  monsterType: string
): DMCommandResult {
  if (!session.gameState) {
    return { success: false, error: "GAME_NOT_STARTED" };
  }

  // Check if position is walkable
  const tile = session.gameState.map.getTile(position.x, position.y);
  if (!tile.walkable) {
    return { success: false, error: "POSITION_NOT_WALKABLE" };
  }

  // Check if position is occupied
  const occupied = session.gameState.units.some(
    (u) => u.position.x === position.x && u.position.y === position.y
  );
  if (occupied) {
    return { success: false, error: "POSITION_OCCUPIED" };
  }

  // Get monster definition
  const monsterDef = getMonsterDefinition(monsterType);
  if (!monsterDef) {
    return { success: false, error: "MONSTER_TYPE_NOT_FOUND" };
  }

  // Create monster unit
  const monster: Unit = {
    id: `monster-${Date.now()}`,
    type: "monster",
    name: monsterDef.name,
    position,
    stats: monsterDef.stats,
  };

  // Add to units array
  const newUnits = [...session.gameState.units, monster];

  const newState: GameState = {
    ...session.gameState,
    units: newUnits,
  };

  session.gameState = newState;
  session.stateVersion += 1;

  // Persist and broadcast
  const db = getDb();
  db.sessions.updateGameState(session.id, newState, session.stateVersion);

  broadcastToSession(session.id, "dm_event", {
    type: "monster_spawned",
    monster,
  });

  console.log(`[dm] Spawned ${monsterType} at (${position.x}, ${position.y}) in session ${session.id}`);

  return { success: true, state: newState };
}

/**
 * Remove a monster from the game.
 */
export function removeMonster(
  session: GameSessionState,
  unitId: string
): DMCommandResult {
  if (!session.gameState) {
    return { success: false, error: "GAME_NOT_STARTED" };
  }

  // Find the unit
  const unitIndex = session.gameState.units.findIndex((u) => u.id === unitId);
  if (unitIndex === -1) {
    return { success: false, error: "UNIT_NOT_FOUND" };
  }

  const unit = session.gameState.units[unitIndex]!;

  // Only allow removing monsters, not players
  if (unit.type !== "monster") {
    return { success: false, error: "NOT_A_MONSTER" };
  }

  // Remove from units array
  const newUnits = session.gameState.units.filter((u) => u.id !== unitId);

  // Also remove from initiative order if present
  const newInitiativeOrder = session.gameState.combat.initiativeOrder.filter(
    (e) => e.unitId !== unitId
  );

  const newCombat = {
    ...session.gameState.combat,
    initiativeOrder: newInitiativeOrder,
  };

  const newState: GameState = {
    ...session.gameState,
    units: newUnits,
    combat: newCombat,
  };

  session.gameState = newState;
  session.stateVersion += 1;

  // Persist and broadcast
  const db = getDb();
  db.sessions.updateGameState(session.id, newState, session.stateVersion);

  broadcastToSession(session.id, "dm_event", {
    type: "monster_removed",
    unitId,
  });

  console.log(`[dm] Removed monster ${unitId} from session ${session.id}`);

  return { success: true, state: newState };
}

/**
 * Modify a monster's stats.
 */
export function modifyMonster(
  session: GameSessionState,
  unitId: string,
  statChanges: Record<string, number>
): DMCommandResult {
  if (!session.gameState) {
    return { success: false, error: "GAME_NOT_STARTED" };
  }

  // Find the unit
  const unitIndex = session.gameState.units.findIndex((u) => u.id === unitId);
  if (unitIndex === -1) {
    return { success: false, error: "UNIT_NOT_FOUND" };
  }

  const unit = session.gameState.units[unitIndex]!;

  // Only allow modifying monsters, not players
  if (unit.type !== "monster") {
    return { success: false, error: "NOT_A_MONSTER" };
  }

  // Apply stat changes
  const newStats = { ...unit.stats };
  for (const [key, value] of Object.entries(statChanges)) {
    if (key in newStats) {
      (newStats as Record<string, number>)[key] = Math.max(0, value);
    }
  }

  // Create updated unit
  const updatedUnit: Unit = {
    ...unit,
    stats: newStats,
  };

  // Update units array
  const newUnits = [...session.gameState.units];
  newUnits[unitIndex] = updatedUnit;

  const newState: GameState = {
    ...session.gameState,
    units: newUnits,
  };

  session.gameState = newState;
  session.stateVersion += 1;

  // Persist and broadcast
  const db = getDb();
  db.sessions.updateGameState(session.id, newState, session.stateVersion);

  broadcastToSession(session.id, "dm_event", {
    type: "monster_modified",
    unitId,
    newStats,
  });

  console.log(`[dm] Modified monster ${unitId} in session ${session.id}`);

  return { success: true, state: newState };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate level from XP.
 * Simple formula: level = floor(sqrt(xp / 100)) + 1
 */
function calculateLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

/**
 * Weapon definitions.
 */
const WEAPON_DEFINITIONS: Record<string, Omit<LootItem, "id">> = {
  short_sword: {
    type: "weapon",
    name: "Short Sword",
    damage: 3,
    range: 1,
    weaponType: "melee",
  },
  long_sword: {
    type: "weapon",
    name: "Long Sword",
    damage: 4,
    range: 1,
    weaponType: "melee",
  },
  great_sword: {
    type: "weapon",
    name: "Great Sword",
    damage: 6,
    range: 1,
    weaponType: "melee",
  },
  dagger: {
    type: "weapon",
    name: "Dagger",
    damage: 2,
    range: 1,
    weaponType: "melee",
  },
  short_bow: {
    type: "weapon",
    name: "Short Bow",
    damage: 2,
    range: 4,
    weaponType: "ranged",
  },
  long_bow: {
    type: "weapon",
    name: "Long Bow",
    damage: 3,
    range: 6,
    weaponType: "ranged",
  },
  crossbow: {
    type: "weapon",
    name: "Crossbow",
    damage: 4,
    range: 5,
    weaponType: "ranged",
  },
  staff: {
    type: "weapon",
    name: "Staff",
    damage: 2,
    range: 1,
    weaponType: "melee",
  },
  wand: {
    type: "weapon",
    name: "Magic Wand",
    damage: 3,
    range: 3,
    weaponType: "ranged",
  },
};

function getWeaponDefinition(weaponId: string): Omit<LootItem, "id"> | null {
  return WEAPON_DEFINITIONS[weaponId] ?? null;
}

/**
 * Monster definitions.
 */
const MONSTER_DEFINITIONS: Record<string, { name: string; stats: Unit["stats"] }> = {
  goblin: {
    name: "Goblin",
    stats: { hp: 6, maxHp: 6, attack: 2, defense: 1, initiative: 4, moveRange: 4, attackRange: 1 },
  },
  goblin_archer: {
    name: "Goblin Archer",
    stats: { hp: 4, maxHp: 4, attack: 3, defense: 0, initiative: 3, moveRange: 3, attackRange: 4 },
  },
  orc: {
    name: "Orc",
    stats: { hp: 12, maxHp: 12, attack: 4, defense: 2, initiative: 2, moveRange: 3, attackRange: 1 },
  },
  orc_warlord: {
    name: "Orc Warlord",
    stats: { hp: 20, maxHp: 20, attack: 5, defense: 3, initiative: 3, moveRange: 3, attackRange: 1 },
  },
  skeleton: {
    name: "Skeleton",
    stats: { hp: 8, maxHp: 8, attack: 3, defense: 2, initiative: 2, moveRange: 3, attackRange: 1 },
  },
  skeleton_archer: {
    name: "Skeleton Archer",
    stats: { hp: 6, maxHp: 6, attack: 3, defense: 1, initiative: 3, moveRange: 2, attackRange: 5 },
  },
  wolf: {
    name: "Dire Wolf",
    stats: { hp: 8, maxHp: 8, attack: 3, defense: 1, initiative: 5, moveRange: 5, attackRange: 1 },
  },
  troll: {
    name: "Troll",
    stats: { hp: 25, maxHp: 25, attack: 6, defense: 2, initiative: 1, moveRange: 2, attackRange: 1 },
  },
  dragon_wyrmling: {
    name: "Dragon Wyrmling",
    stats: { hp: 30, maxHp: 30, attack: 7, defense: 4, initiative: 3, moveRange: 4, attackRange: 3 },
  },
};

function getMonsterDefinition(monsterType: string): { name: string; stats: Unit["stats"] } | null {
  return MONSTER_DEFINITIONS[monsterType] ?? null;
}

/**
 * Get list of available weapon IDs.
 */
export function getAvailableWeapons(): string[] {
  return Object.keys(WEAPON_DEFINITIONS);
}

/**
 * Get list of available monster types.
 */
export function getAvailableMonsterTypes(): string[] {
  return Object.keys(MONSTER_DEFINITIONS);
}
