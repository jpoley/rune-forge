/**
 * @rune-forge/simulation
 *
 * Headless, deterministic combat simulation engine.
 * This package contains no rendering dependencies and can run
 * in any JavaScript environment (browser, Node, Bun, etc.).
 */

// Types
export * from "./types.js";

// Core systems
export {
  findPath,
  getReachablePositions,
} from "./pathfinding.js";

export {
  hasLineOfSight,
  findBlockingTile,
  getLineOfSightPath,
  isAdjacent,
  getDistance,
  getPositionsInRange,
} from "./line-of-sight.js";

// Combat engine
export {
  startCombat,
  executeAction,
  validateAction,
  rollInitiative,
  getValidMoveTargets,
  getValidAttackTargets,
} from "./combat.js";

// Map and unit generation
export {
  generateMap,
  generateUnits,
  generateGameState,
  type MapGeneratorOptions,
  type UnitGeneratorOptions,
  type GameGeneratorOptions,
} from "./map-generator.js";

// Loot system
export {
  generateLootDrop,
  getEquippedWeapon,
  getEquippedWeaponDamage,
  getEquippedWeaponRange,
  collectLoot,
  canCollectLoot,
  WEAPON_DEFINITIONS,
  DEFAULT_INVENTORY,
  type WeaponDefinition,
  type WeaponType,
} from "./loot.js";
