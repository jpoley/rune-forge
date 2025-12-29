/**
 * Random map generator for combat encounters.
 * Produces deterministic maps given the same seed.
 */

import type { GameMap, GridSize, Position, Tile, TileType, Unit, UnitStats } from "./types.js";
import { TILE_DEFINITIONS } from "./types.js";

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
// Map Generation
// =============================================================================

export interface MapGeneratorOptions {
  seed: number;
  width?: number;
  height?: number;
  wallDensity?: number; // 0-1, probability of wall/pillar placement
  name?: string;
}

const DEFAULT_OPTIONS = {
  width: 20,
  height: 20,
  wallDensity: 0.15,
  name: "Generated Arena",
} as const;

// Obstacle types with their relative weights
const OBSTACLE_TYPES: { type: TileType; weight: number }[] = [
  { type: "rock", weight: 3 },
  { type: "tree", weight: 4 },
  { type: "bush", weight: 2 },
  { type: "wall", weight: 2 },
  { type: "pillar", weight: 1 },
];

/**
 * Generate a random combat map with the given options.
 */
export function generateMap(options: MapGeneratorOptions): GameMap {
  const rng = new SeededRandom(options.seed);
  const width = options.width ?? DEFAULT_OPTIONS.width;
  const height = options.height ?? DEFAULT_OPTIONS.height;
  const wallDensity = options.wallDensity ?? DEFAULT_OPTIONS.wallDensity;
  const name = options.name ?? DEFAULT_OPTIONS.name;

  // Initialize all tiles with varied ground using Perlin-like noise
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      // Use position-based randomness for natural clustering
      const noiseVal = simpleNoise(x, y, options.seed);
      const groundType = pickGroundTile(noiseVal, rng);
      tiles[y]![x] = createTile(groundType);
    }
  }

  // Add some water pools (small clusters)
  const waterPools = rng.nextInt(1, 3);
  for (let i = 0; i < waterPools; i++) {
    const poolX = rng.nextInt(4, width - 5);
    const poolY = rng.nextInt(4, height - 5);
    const poolSize = rng.nextInt(2, 4);

    for (let dy = -poolSize; dy <= poolSize; dy++) {
      for (let dx = -poolSize; dx <= poolSize; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= poolSize && rng.nextBool(0.7)) {
          const px = poolX + dx;
          const py = poolY + dy;
          if (px >= 0 && px < width && py >= 0 && py < height) {
            const waterType: TileType = dist < poolSize * 0.5 ? "water_deep" : "water";
            tiles[py]![px] = createTile(waterType);
          }
        }
      }
    }
    // Add sand around water
    for (let dy = -poolSize - 1; dy <= poolSize + 1; dy++) {
      for (let dx = -poolSize - 1; dx <= poolSize + 1; dx++) {
        const px = poolX + dx;
        const py = poolY + dy;
        if (px >= 0 && px < width && py >= 0 && py < height) {
          const tile = tiles[py]![px]!;
          if (tile.type !== "water" && tile.type !== "water_deep" && rng.nextBool(0.4)) {
            tiles[py]![px] = createTile("sand");
          }
        }
      }
    }
  }

  // Add random obstacles (rocks, trees, bushes, walls, pillars)
  const interiorStartX = 2;
  const interiorEndX = width - 3;
  const interiorStartY = 2;
  const interiorEndY = height - 3;

  const totalWeight = OBSTACLE_TYPES.reduce((sum, o) => sum + o.weight, 0);

  for (let y = interiorStartY; y <= interiorEndY; y++) {
    for (let x = interiorStartX; x <= interiorEndX; x++) {
      const currentTile = tiles[y]![x]!;
      // Don't place obstacles on water
      if (currentTile.type === "water" || currentTile.type === "water_deep") continue;

      if (rng.nextBool(wallDensity)) {
        // Weighted random selection of obstacle type
        let roll = rng.next() * totalWeight;
        let selectedType: TileType = "rock";
        for (const obstacle of OBSTACLE_TYPES) {
          roll -= obstacle.weight;
          if (roll <= 0) {
            selectedType = obstacle.type;
            break;
          }
        }
        tiles[y]![x] = createTile(selectedType);
      }
    }
  }

  // Ensure spawn areas are clear (corners) - use grass for clarity
  clearArea(tiles, 1, 1, 3, 3, "grass_light"); // Top-left for player
  clearArea(tiles, width - 4, 1, 3, 3, "grass_light"); // Top-right for monster
  clearArea(tiles, 1, height - 4, 3, 3, "grass_light"); // Bottom-left for monster
  clearArea(tiles, width - 4, height - 4, 3, 3, "grass_light"); // Bottom-right for monster

  return {
    id: `map-${options.seed}`,
    name,
    size: { width, height },
    tiles,
    seed: options.seed,
  };
}

/**
 * Simple noise function for natural-looking terrain variation.
 */
function simpleNoise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Pick a ground tile based on noise value - all green shades.
 */
function pickGroundTile(noise: number, _rng: SeededRandom): TileType {
  // Create natural-looking patches using only green variants
  if (noise < 0.3) return "grass_dark";
  if (noise < 0.6) return "grass_light";
  if (noise < 0.85) return "floor"; // floor is also green-tinted
  return "grass_light";
}

function clearArea(
  tiles: Tile[][],
  startX: number,
  startY: number,
  width: number,
  height: number,
  tileType: TileType = "floor"
): void {
  for (let y = startY; y < startY + height; y++) {
    for (let x = startX; x < startX + width; x++) {
      if (tiles[y] && tiles[y]![x]) {
        tiles[y]![x] = createTile(tileType);
      }
    }
  }
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

export interface UnitGeneratorOptions {
  seed: number;
  mapSize: GridSize;
  playerName?: string;
  monsterCount?: number;
}

/**
 * Generate units for a combat encounter.
 * Places player in one corner and monsters distributed around the map.
 * Spawns 3-6 monsters by default with varied types.
 */
export function generateUnits(options: UnitGeneratorOptions): Unit[] {
  const rng = new SeededRandom(options.seed + 1000); // Different seed from map
  // Random 3-6 monsters if not specified
  const monsterCount = options.monsterCount ?? rng.nextInt(3, 6);
  const units: Unit[] = [];

  // Spawn player in top-left area
  const player: Unit = {
    id: "player-1",
    type: "player",
    name: options.playerName ?? "Hero",
    position: { x: 2, y: 2 },
    stats: { ...PLAYER_BASE_STATS },
  };
  units.push(player);

  // Generate more spawn positions to accommodate up to 6 monsters
  const monsterSpawns: Position[] = [
    { x: options.mapSize.width - 3, y: 2 }, // Top-right
    { x: 2, y: options.mapSize.height - 3 }, // Bottom-left
    { x: options.mapSize.width - 3, y: options.mapSize.height - 3 }, // Bottom-right
    { x: Math.floor(options.mapSize.width / 2), y: 2 }, // Top-center
    { x: Math.floor(options.mapSize.width / 2), y: options.mapSize.height - 3 }, // Bottom-center
    { x: options.mapSize.width - 3, y: Math.floor(options.mapSize.height / 2) }, // Right-center
    { x: Math.floor(options.mapSize.width / 2), y: Math.floor(options.mapSize.height / 2) }, // Center
    { x: Math.floor(options.mapSize.width * 0.75), y: Math.floor(options.mapSize.height * 0.75) }, // Lower-right quadrant
  ];

  // Shuffle and pick spawn positions
  const shuffledSpawns = rng.shuffle(monsterSpawns);

  for (let i = 0; i < monsterCount && i < shuffledSpawns.length; i++) {
    // Pick a random monster type
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
  mapWidth?: number;
  mapHeight?: number;
  wallDensity?: number;
  playerName?: string;
  monsterCount?: number;
}

/**
 * Generate a complete initial game state ready for combat.
 */
export function generateGameState(options: GameGeneratorOptions): import("./types.js").GameState {
  const mapOptions: MapGeneratorOptions = {
    seed: options.seed,
  };
  if (options.mapWidth !== undefined) mapOptions.width = options.mapWidth;
  if (options.mapHeight !== undefined) mapOptions.height = options.mapHeight;
  if (options.wallDensity !== undefined) mapOptions.wallDensity = options.wallDensity;

  const map = generateMap(mapOptions);

  const unitOptions: UnitGeneratorOptions = {
    seed: options.seed,
    mapSize: map.size,
  };
  if (options.playerName !== undefined) unitOptions.playerName = options.playerName;
  if (options.monsterCount !== undefined) unitOptions.monsterCount = options.monsterCount;

  const units = generateUnits(unitOptions);

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
  };
}
