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
  | "tree"
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
  rock: { walkable: false, blocksLos: true },
  tree: { walkable: false, blocksLos: true },
  bush: { walkable: false, blocksLos: false },
} as const;

// =============================================================================
// Units
// =============================================================================

export type UnitType = "player" | "monster";

export interface UnitStats {
  readonly hp: number;
  readonly maxHp: number;
  readonly attack: number;
  readonly defense: number;
  readonly initiative: number;
  readonly moveRange: number;
  readonly attackRange: number; // 1 for melee, > 1 for ranged
}

export interface Unit {
  readonly id: string;
  readonly type: UnitType;
  readonly name: string;
  readonly position: Position;
  readonly stats: UnitStats;
}

// =============================================================================
// Map
// =============================================================================

export interface GameMap {
  readonly id: string;
  readonly name: string;
  readonly size: GridSize;
  readonly tiles: ReadonlyArray<ReadonlyArray<Tile>>; // [y][x] access
  readonly seed?: number; // For reproducible random generation
}

// =============================================================================
// Combat State
// =============================================================================

export interface InitiativeEntry {
  readonly unitId: string;
  readonly roll: number; // initiative stat + any random component
}

export type CombatPhase = "not_started" | "in_progress" | "victory" | "defeat";

export type TurnPhase = "move" | "action" | "ended";

export interface TurnState {
  readonly unitId: string;
  readonly phase: TurnPhase;
  readonly movementRemaining: number;
  readonly hasActed: boolean;
}

export interface CombatState {
  readonly phase: CombatPhase;
  readonly round: number;
  readonly initiativeOrder: ReadonlyArray<InitiativeEntry>;
  readonly currentTurnIndex: number;
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
}

// =============================================================================
// Actions (Player/AI Inputs)
// =============================================================================

export type ActionType = "move" | "attack" | "end_turn";

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

export type GameAction = MoveAction | AttackAction | EndTurnAction;

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
  | "combat_ended";

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

export type GameEvent =
  | CombatStartedEvent
  | RoundStartedEvent
  | TurnStartedEvent
  | UnitMovedEvent
  | UnitAttackedEvent
  | UnitDamagedEvent
  | UnitDefeatedEvent
  | TurnEndedEvent
  | CombatEndedEvent;

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
