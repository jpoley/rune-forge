/**
 * Core type definitions for the Rune Forge simulation.
 * These types are renderer-agnostic and define the game's data model.
 */

// =============================================================================
// Position & Grid
// =============================================================================

export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface GridSize {
  readonly width: number;
  readonly height: number;
}

// =============================================================================
// Tiles
// =============================================================================

export type TileType =
  | "floor"
  | "grass_light"
  | "grass_dark"
  | "dirt"
  | "sand"
  | "water"
  | "water_deep"
  | "wall"
  | "pillar"
  | "rock"
  | "rock_mossy"
  | "rock_large"
  | "boulder"
  | "stone_pile"
  | "tree"
  | "tree_pine"
  | "tree_oak"
  | "tree_dead"
  | "tree_small"
  | "bush";

export interface Tile {
  readonly type: TileType;
  readonly walkable: boolean;
  readonly blocksLos: boolean;
}

export const TILE_DEFINITIONS: Record<TileType, Omit<Tile, "type">> = {
  floor: { walkable: true, blocksLos: false },
  grass_light: { walkable: true, blocksLos: false },
  grass_dark: { walkable: true, blocksLos: false },
  dirt: { walkable: true, blocksLos: false },
  sand: { walkable: true, blocksLos: false },
  water: { walkable: false, blocksLos: false },
  water_deep: { walkable: false, blocksLos: false },
  wall: { walkable: false, blocksLos: true },
  pillar: { walkable: false, blocksLos: true },
  // 5 rock types
  rock: { walkable: false, blocksLos: true },
  rock_mossy: { walkable: false, blocksLos: true },
  rock_large: { walkable: false, blocksLos: true },
  boulder: { walkable: false, blocksLos: true },
  stone_pile: { walkable: false, blocksLos: true },
  // 5 tree types
  tree: { walkable: false, blocksLos: true },
  tree_pine: { walkable: false, blocksLos: true },
  tree_oak: { walkable: false, blocksLos: true },
  tree_dead: { walkable: false, blocksLos: true },
  tree_small: { walkable: false, blocksLos: true },
  bush: { walkable: true, blocksLos: false },
} as const;

// =============================================================================
// Units
// =============================================================================

export type UnitType = "player" | "monster" | "npc";

export interface UnitStats {
  readonly hp: number;
  readonly maxHp: number;
  readonly attack: number;
  readonly defense: number;
  readonly initiative: number;
  readonly moveRange: number;
  readonly attackRange: number; // 1 for melee, > 1 for ranged
}

export type Team = "player" | "monster" | "neutral";

export interface Unit {
  readonly id: string;
  readonly type: UnitType;
  readonly name: string;
  readonly position: Position;
  readonly stats: UnitStats;
  readonly team?: Team;        // For multiplayer team assignment
  readonly isPlayer?: boolean; // True if controlled by a human player
  readonly hp?: number;        // Current HP (defaults to stats.maxHp)
}

// =============================================================================
// Loot & Inventory
// =============================================================================

export type ItemType = "gold" | "silver" | "weapon";

export interface LootItem {
  readonly id: string;
  readonly type: ItemType;
  readonly name: string;
  readonly value?: number;        // Coin value (gold=10, silver=1 per coin)
  readonly damage?: number;       // Weapon base damage
  readonly range?: number;        // Weapon attack range in tiles
  readonly weaponType?: "melee" | "ranged";
}

export interface LootDrop {
  readonly id: string;
  readonly position: Position;
  readonly items: ReadonlyArray<LootItem>;
}

export interface PlayerInventory {
  readonly gold: number;
  readonly silver: number;
  readonly weapons: ReadonlyArray<LootItem>;
  readonly items?: ReadonlyArray<LootItem>;  // All items (weapons, consumables, etc.)
  readonly equippedWeaponId: string | null;
}

// =============================================================================
// Map
// =============================================================================

/**
 * Infinite procedural map - tiles are generated on-demand using the seed.
 * No boundaries - any coordinate is valid.
 */
export interface GameMap {
  readonly id: string;
  readonly name: string;
  readonly seed: number; // Required for procedural generation
  /** Get tile at any coordinate - generates on demand */
  getTile(x: number, y: number): Tile;
}

// =============================================================================
// Combat State
// =============================================================================

export interface InitiativeEntry {
  readonly unitId: string;
  readonly roll: number; // initiative stat + any random component
}

export type CombatPhase = "not_started" | "setup" | "in_progress" | "victory" | "defeat";

export type TurnPhase = "move" | "action" | "ended";

export interface TurnState {
  readonly unitId: string;
  readonly phase: TurnPhase;
  readonly movementRemaining: number;
  readonly hasActed: boolean;
}

export interface CombatState {
  readonly phase: CombatPhase;
  readonly round: number;                 // Current round number
  readonly turnNumber?: number;           // Cumulative turn count across all rounds
  readonly initiativeOrder: ReadonlyArray<InitiativeEntry>;
  readonly currentTurnIndex: number;      // Index in initiativeOrder
  readonly turnState: TurnState | null;
}

// =============================================================================
// Game State (Complete Simulation State)
// =============================================================================

export interface GameState {
  readonly map: GameMap;
  readonly units: ReadonlyArray<Unit>;
  readonly combat: CombatState;
  readonly turnHistory: ReadonlyArray<GameEvent>; // For replay/debugging
  readonly lootDrops: ReadonlyArray<LootDrop>;
  readonly loot?: ReadonlyArray<LootDrop>;        // Alias for lootDrops (legacy)
  readonly playerInventory: PlayerInventory;
}

// =============================================================================
// Actions (Player/AI Inputs)
// =============================================================================

export type ActionType = "move" | "attack" | "end_turn" | "collect_loot";

export interface MoveAction {
  readonly type: "move";
  readonly unitId: string;
  readonly path: ReadonlyArray<Position>; // Full path for animation
}

export interface AttackAction {
  readonly type: "attack";
  readonly unitId: string;
  readonly targetId: string;
}

export interface EndTurnAction {
  readonly type: "end_turn";
  readonly unitId: string;
}

export interface CollectLootAction {
  readonly type: "collect_loot";
  readonly unitId: string;
  readonly lootDropId: string;
}

export type GameAction = MoveAction | AttackAction | EndTurnAction | CollectLootAction;

// =============================================================================
// Events (Simulation Outputs)
// =============================================================================

export type EventType =
  | "combat_started"
  | "round_started"
  | "turn_started"
  | "unit_moved"
  | "unit_attacked"
  | "unit_damaged"
  | "unit_defeated"
  | "turn_ended"
  | "combat_ended"
  | "loot_dropped"
  | "loot_collected";

export interface BaseEvent {
  readonly timestamp: number;
  readonly round: number;
}

export interface CombatStartedEvent extends BaseEvent {
  readonly type: "combat_started";
  readonly initiativeOrder: ReadonlyArray<InitiativeEntry>;
}

export interface RoundStartedEvent extends BaseEvent {
  readonly type: "round_started";
}

export interface TurnStartedEvent extends BaseEvent {
  readonly type: "turn_started";
  readonly unitId: string;
}

export interface UnitMovedEvent extends BaseEvent {
  readonly type: "unit_moved";
  readonly unitId: string;
  readonly from: Position;
  readonly to: Position;
  readonly path: ReadonlyArray<Position>;
}

export interface UnitAttackedEvent extends BaseEvent {
  readonly type: "unit_attacked";
  readonly attackerId: string;
  readonly targetId: string;
}

export interface UnitDamagedEvent extends BaseEvent {
  readonly type: "unit_damaged";
  readonly unitId: string;
  readonly damage: number;
  readonly remainingHp: number;
}

export interface UnitDefeatedEvent extends BaseEvent {
  readonly type: "unit_defeated";
  readonly unitId: string;
}

export interface TurnEndedEvent extends BaseEvent {
  readonly type: "turn_ended";
  readonly unitId: string;
}

export interface CombatEndedEvent extends BaseEvent {
  readonly type: "combat_ended";
  readonly result: "victory" | "defeat";
}

export interface LootDroppedEvent extends BaseEvent {
  readonly type: "loot_dropped";
  readonly lootDrop: LootDrop;
  readonly fromUnitId: string;
}

export interface LootCollectedEvent extends BaseEvent {
  readonly type: "loot_collected";
  readonly lootDropId: string;
  readonly items: ReadonlyArray<LootItem>;
  readonly collectedBy: string;
}

export type GameEvent =
  | CombatStartedEvent
  | RoundStartedEvent
  | TurnStartedEvent
  | UnitMovedEvent
  | UnitAttackedEvent
  | UnitDamagedEvent
  | UnitDefeatedEvent
  | TurnEndedEvent
  | CombatEndedEvent
  | LootDroppedEvent
  | LootCollectedEvent;

// =============================================================================
// Save Data
// =============================================================================

export interface SaveMetadata {
  readonly slot: number; // 1-10
  readonly timestamp: number;
  readonly version: number; // For migration compatibility
  readonly name: string;
}

export interface SaveData extends SaveMetadata {
  readonly gameState: GameState;
}

// =============================================================================
// Validation Results
// =============================================================================

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}
