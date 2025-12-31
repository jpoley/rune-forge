/**
 * Random map generator for combat encounters.
 * Produces deterministic maps given the same seed.
 */

import type { GameMap, LootDrop, Position, Tile, TileType, Unit, UnitStats } from "./types.js";
import { TILE_DEFINITIONS } from "./types.js";
import { DEFAULT_INVENTORY, generateLootDrop } from "./loot.js";

// =============================================================================
// Seeded Random Number Generator
// =============================================================================

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextBool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }
}

// =============================================================================
// Tile Creation
// =============================================================================

function createTile(type: TileType): Tile {
  return {
    type,
    ...TILE_DEFINITIONS[type],
  };
}

// =============================================================================
// Map Generation - Infinite Procedural World
// =============================================================================

export interface MapGeneratorOptions {
  seed: number;
  wallDensity?: number; // 0-1, probability of obstacle placement
  name?: string;
}

const DEFAULT_OPTIONS = {
  wallDensity: 0.12,
  name: "Infinite World",
} as const;

// Obstacle types with their relative weights
const OBSTACLE_TYPES: { type: TileType; weight: number }[] = [
  // Rock types
  { type: "rock", weight: 2 },
  { type: "rock_mossy", weight: 2 },
  { type: "rock_large", weight: 1 },
  { type: "boulder", weight: 1 },
  { type: "stone_pile", weight: 2 },
  // Tree types
  { type: "tree", weight: 2 },
  { type: "tree_pine", weight: 2 },
  { type: "tree_oak", weight: 1 },
  { type: "tree_dead", weight: 1 },
  { type: "tree_small", weight: 2 },
  // Other obstacles
  { type: "bush", weight: 3 },
];

const TOTAL_OBSTACLE_WEIGHT = OBSTACLE_TYPES.reduce((sum, o) => sum + o.weight, 0);

/**
 * Generate an infinite procedural map.
 * Tiles are generated on-demand using deterministic hash functions.
 */
export function generateMap(options: MapGeneratorOptions): GameMap {
  const seed = options.seed;
  const wallDensity = options.wallDensity ?? DEFAULT_OPTIONS.wallDensity;
  const name = options.name ?? DEFAULT_OPTIONS.name;

  // Cache for generated tiles (performance optimization)
  const tileCache = new Map<string, Tile>();

  /**
   * Get tile at any coordinate - generates procedurally if not cached.
   */
  function getTile(x: number, y: number): Tile {
    const key = `${x},${y}`;
    const cached = tileCache.get(key);
    if (cached) return cached;

    const tile = generateTileAt(x, y, seed, wallDensity);
    tileCache.set(key, tile);
    return tile;
  }

  return {
    id: `map-${seed}`,
    name,
    seed,
    getTile,
  };
}

/**
 * Generate a single tile at the given coordinates.
 * Uses multiple hash functions for different terrain features.
 */
function generateTileAt(x: number, y: number, seed: number, wallDensity: number): Tile {
  // Check for water (using large-scale noise for pools)
  const waterNoise = hashPosition(Math.floor(x / 8), Math.floor(y / 8), seed + 11111);
  const waterDetail = hashPosition(x, y, seed + 22222);

  if (waterNoise < 0.15) {
    // This area might be water
    const distFromCenter = waterDetail;
    if (distFromCenter < 0.4) {
      return createTile(distFromCenter < 0.2 ? "water_deep" : "water");
    }
    // Sand around water
    if (distFromCenter < 0.6 && hashPosition(x, y, seed + 33333) < 0.5) {
      return createTile("sand");
    }
  }

  // Check for obstacles
  const obstacleNoise = hashPosition(x, y, seed + 12345);
  if (obstacleNoise < wallDensity) {
    // Pick obstacle type
    const typeNoise = hashPosition(x, y, seed + 54321);
    let roll = typeNoise * TOTAL_OBSTACLE_WEIGHT;
    for (const obstacle of OBSTACLE_TYPES) {
      roll -= obstacle.weight;
      if (roll <= 0) {
        return createTile(obstacle.type);
      }
    }
    return createTile("rock");
  }

  // Ground tile - varied grass
  const groundNoise = hashPosition(x, y, seed);
  return createTile(pickGroundTile(groundNoise));
}

/**
 * Clear a spawn area around a position (makes tiles walkable).
 * Note: For infinite maps, spawn areas are kept clear by checking distance from spawn points
 * in generateTileAt. This function is kept for API compatibility.
 */
export function clearSpawnArea(_map: GameMap, _centerX: number, _centerY: number, _radius: number): void {
  // No-op for infinite maps - spawn areas are handled by isSpawnArea checks
}

/**
 * Check if a position is in a spawn area (should be kept clear).
 */
export function isSpawnArea(x: number, y: number, spawnPoints: Position[]): boolean {
  for (const spawn of spawnPoints) {
    const dx = Math.abs(x - spawn.x);
    const dy = Math.abs(y - spawn.y);
    if (dx <= 2 && dy <= 2) return true;
  }
  return false;
}

/**
 * Hash function for position-based randomness with uniform distribution.
 * Uses integer mixing to produce well-distributed values.
 */
function hashPosition(x: number, y: number, seed: number): number {
  // Ensure integer inputs
  const ix = Math.floor(x) | 0;
  const iy = Math.floor(y) | 0;
  let h = Math.floor(seed) | 0;

  // Mix coordinates with seed using multiplication and XOR
  // This produces much more uniform distribution than sin-based noise
  h = Math.imul(h ^ ix, 0x45d9f3b);
  h = Math.imul(h ^ iy, 0x45d9f3b);
  h = h ^ (h >>> 16);
  h = Math.imul(h, 0x45d9f3b);
  h = h ^ (h >>> 16);

  // Convert to 0-1 range (use >>> 0 to treat as unsigned)
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Pick a ground tile based on noise value - all green shades.
 */
function pickGroundTile(noise: number): TileType {
  if (noise < 0.3) return "grass_dark";
  if (noise < 0.6) return "grass_light";
  if (noise < 0.85) return "floor";
  return "grass_light";
}

// =============================================================================
// Unit Generation
// =============================================================================

const PLAYER_BASE_STATS: UnitStats = {
  hp: 50,
  maxHp: 50,
  attack: 10,
  defense: 5,
  initiative: 12,
  moveRange: 4,
  attackRange: 1, // Melee
};

const MONSTER_BASE_STATS: UnitStats = {
  hp: 25,
  maxHp: 25,
  attack: 6,
  defense: 2,
  initiative: 8,
  moveRange: 3,
  attackRange: 1, // Melee
};

// Monster types for variety
const MONSTER_TYPES = [
  { name: "Goblin", hpMod: 0, attackMod: 0, initMod: 2 },
  { name: "Orc", hpMod: 10, attackMod: 2, initMod: -2 },
  { name: "Skeleton", hpMod: -5, attackMod: 1, initMod: 1 },
  { name: "Imp", hpMod: -10, attackMod: -1, initMod: 4 },
] as const;

// =============================================================================
// NPC Companion Types
// =============================================================================

// NPC class types with stat modifiers and abilities
export interface NPCClass {
  readonly name: string;
  readonly displayName: string;
  readonly hpMod: number;
  readonly attackMod: number;
  readonly defenseMod: number;
  readonly initMod: number;
  readonly rangeMod: number; // 0 = melee, 1+ = ranged
}

export const NPC_CLASSES: readonly NPCClass[] = [
  { name: "warrior", displayName: "Warrior", hpMod: 10, attackMod: 2, defenseMod: 2, initMod: -1, rangeMod: 0 },
  { name: "archer", displayName: "Archer", hpMod: -5, attackMod: 2, defenseMod: -1, initMod: 2, rangeMod: 4 },
  { name: "mage", displayName: "Mage", hpMod: -10, attackMod: 4, defenseMod: -2, initMod: 1, rangeMod: 5 },
  { name: "cleric", displayName: "Cleric", hpMod: 5, attackMod: -1, defenseMod: 1, initMod: 0, rangeMod: 0 },
  { name: "rogue", displayName: "Rogue", hpMod: -5, attackMod: 3, defenseMod: 0, initMod: 4, rangeMod: 0 },
] as const;

// NPC name pools
const NPC_FIRST_NAMES = [
  "Aldric", "Brynn", "Cedric", "Dara", "Elric", "Fiona", "Gareth", "Hilda",
  "Ivan", "Jade", "Kira", "Lyra", "Magnus", "Nora", "Owen", "Petra",
  "Quinn", "Raven", "Soren", "Thora", "Uri", "Vera", "Wren", "Xena", "Yuri", "Zara",
];

const NPC_BASE_STATS: UnitStats = {
  hp: 30,
  maxHp: 30,
  attack: 7,
  defense: 4,
  initiative: 10,
  moveRange: 4,
  attackRange: 1,
};

// NPC spawn offsets (close to player, friendly positions)
const NPC_SPAWN_OFFSETS: Position[] = [
  { x: -2, y: 0 },
  { x: 2, y: 0 },
  { x: 0, y: -2 },
  { x: 0, y: 2 },
  { x: -2, y: -2 },
  { x: 2, y: -2 },
  { x: -2, y: 2 },
  { x: 2, y: 2 },
];

export interface NPCGeneratorOptions {
  seed: number;
  playerStart?: Position;
  count: number;
  /** Specific class names to use (e.g., ["warrior", "archer", "archer"]). If provided, count is ignored. */
  classes?: string[];
  /** Override move range for all generated units (default: from class stats) */
  moveRange?: number;
}

/** Get NPC class by name */
export function getNPCClass(name: string): NPCClass | undefined {
  return NPC_CLASSES.find(c => c.name === name);
}

/** Get all available NPC class names */
export function getNPCClassNames(): string[] {
  return NPC_CLASSES.map(c => c.name);
}

/**
 * Generate NPC companions. If classes are specified, uses those (allows duplicates).
 * Otherwise generates random NPCs up to count.
 */
export function generateNPCs(options: NPCGeneratorOptions): Unit[] {
  const rng = new SeededRandom(options.seed + 2000);
  const playerStart = options.playerStart ?? { x: 0, y: 0 };
  const npcs: Unit[] = [];

  // Shuffle spawn positions
  const shuffledSpawns = rng.shuffle([...NPC_SPAWN_OFFSETS]);

  // Determine which classes to use
  const classesToUse: NPCClass[] = [];
  if (options.classes && options.classes.length > 0) {
    // Use specific classes (allows duplicates)
    for (const className of options.classes) {
      const npcClass = getNPCClass(className);
      if (npcClass) {
        classesToUse.push(npcClass);
      }
    }
  } else {
    // Random classes up to count
    for (let i = 0; i < options.count; i++) {
      classesToUse.push(NPC_CLASSES[rng.nextInt(0, NPC_CLASSES.length - 1)]!);
    }
  }

  for (let i = 0; i < classesToUse.length && i < shuffledSpawns.length; i++) {
    const npcClass = classesToUse[i]!;
    // Pick random name
    const firstName = NPC_FIRST_NAMES[rng.nextInt(0, NPC_FIRST_NAMES.length - 1)]!;

    const baseHp = NPC_BASE_STATS.maxHp + npcClass.hpMod;
    const maxHp = baseHp + rng.nextInt(-2, 2);

    const npc: Unit = {
      id: `npc-${i + 1}`,
      type: "npc",
      name: `${firstName} (${npcClass.displayName})`,
      position: {
        x: playerStart.x + shuffledSpawns[i]!.x,
        y: playerStart.y + shuffledSpawns[i]!.y,
      },
      stats: {
        hp: maxHp,
        maxHp,
        attack: NPC_BASE_STATS.attack + npcClass.attackMod + rng.nextInt(-1, 1),
        defense: NPC_BASE_STATS.defense + npcClass.defenseMod,
        initiative: NPC_BASE_STATS.initiative + npcClass.initMod + rng.nextInt(-1, 1),
        moveRange: options.moveRange ?? NPC_BASE_STATS.moveRange,
        attackRange: NPC_BASE_STATS.attackRange + npcClass.rangeMod,
      },
    };
    npcs.push(npc);
  }

  return npcs;
}

export interface UnitGeneratorOptions {
  seed: number;
  playerStart?: Position;
  playerName?: string;
  monsterCount?: number;
  /** Override move range for the player unit (default: from base stats) */
  playerMoveRange?: number;
}

// Monster spawn offsets from player start (for infinite world)
const MONSTER_SPAWN_OFFSETS: Position[] = [
  { x: 15, y: 0 },   // East
  { x: -15, y: 0 },  // West
  { x: 0, y: 15 },   // South
  { x: 0, y: -15 },  // North
  { x: 10, y: 10 },  // Southeast
  { x: -10, y: 10 }, // Southwest
  { x: 10, y: -10 }, // Northeast
  { x: -10, y: -10 }, // Northwest
];

/**
 * Generate units for a combat encounter in infinite world.
 * Player starts at origin (0,0) by default, monsters spawn at offsets.
 */
export function generateUnits(options: UnitGeneratorOptions): Unit[] {
  const rng = new SeededRandom(options.seed + 1000);
  const monsterCount = options.monsterCount ?? rng.nextInt(3, 6);
  const playerStart = options.playerStart ?? { x: 0, y: 0 };
  const units: Unit[] = [];

  // Spawn player
  const player: Unit = {
    id: "player-1",
    type: "player",
    name: options.playerName ?? "Hero",
    position: playerStart,
    stats: {
      ...PLAYER_BASE_STATS,
      moveRange: options.playerMoveRange ?? PLAYER_BASE_STATS.moveRange,
    },
  };
  units.push(player);

  // Generate monster positions relative to player
  const monsterSpawns: Position[] = MONSTER_SPAWN_OFFSETS.map(offset => ({
    x: playerStart.x + offset.x,
    y: playerStart.y + offset.y,
  }));

  // Shuffle and pick spawn positions
  const shuffledSpawns = rng.shuffle(monsterSpawns);

  for (let i = 0; i < monsterCount && i < shuffledSpawns.length; i++) {
    const monsterType = MONSTER_TYPES[rng.nextInt(0, MONSTER_TYPES.length - 1)]!;
    const baseHp = MONSTER_BASE_STATS.maxHp + monsterType.hpMod;
    const maxHp = baseHp + rng.nextInt(-3, 3);

    const monster: Unit = {
      id: `monster-${i + 1}`,
      type: "monster",
      name: `${monsterType.name} ${i + 1}`,
      position: shuffledSpawns[i]!,
      stats: {
        ...MONSTER_BASE_STATS,
        hp: maxHp,
        maxHp,
        attack: MONSTER_BASE_STATS.attack + monsterType.attackMod + rng.nextInt(-1, 1),
        initiative: MONSTER_BASE_STATS.initiative + monsterType.initMod + rng.nextInt(-1, 1),
      },
    };
    units.push(monster);
  }

  return units;
}

// =============================================================================
// Initial Game State Generation
// =============================================================================

export interface GameGeneratorOptions {
  seed: number;
  wallDensity?: number;
  playerName?: string;
  playerStart?: Position;
  monsterCount?: number;
  /** Number of NPC companions to add (0-7, default 0) */
  npcCount?: number;
}

/**
 * Generate a complete initial game state for infinite world combat.
 */
export function generateGameState(options: GameGeneratorOptions): import("./types.js").GameState {
  const mapOptions: MapGeneratorOptions = {
    seed: options.seed,
  };
  if (options.wallDensity !== undefined) mapOptions.wallDensity = options.wallDensity;

  const map = generateMap(mapOptions);

  const playerStart = options.playerStart ?? { x: 0, y: 0 };
  const unitOptions: UnitGeneratorOptions = {
    seed: options.seed,
    playerStart,
  };
  if (options.playerName !== undefined) unitOptions.playerName = options.playerName;
  if (options.monsterCount !== undefined) unitOptions.monsterCount = options.monsterCount;

  const units = generateUnits(unitOptions);

  // Generate NPC companions if requested
  const npcCount = options.npcCount ?? 0;
  if (npcCount > 0) {
    const npcs = generateNPCs({
      seed: options.seed,
      playerStart,
      count: Math.min(npcCount, 7), // Max 7 NPCs
    });
    units.push(...npcs);
  }

  // Generate a test loot bag near player start
  const testLootDrops: LootDrop[] = [];
  const testLoot = generateLootDrop({ x: playerStart.x + 1, y: playerStart.y + 1 }, options.seed + 9999);
  if (testLoot) {
    testLootDrops.push(testLoot);
  }

  return {
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
    lootDrops: testLootDrops,
    playerInventory: DEFAULT_INVENTORY,
  };
}
