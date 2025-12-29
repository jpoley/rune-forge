/**
 * Combat simulation engine.
 * Manages turn-based combat with initiative queue, actions, and state transitions.
 * This is the core headless simulation - completely renderer-agnostic.
 */

import type {
  AttackAction,
  CombatEndedEvent,
  CombatStartedEvent,
  CombatState,
  EndTurnAction,
  GameAction,
  GameEvent,
  GameState,
  InitiativeEntry,
  MoveAction,
  Position,
  RoundStartedEvent,
  TurnEndedEvent,
  TurnStartedEvent,
  TurnState,
  Unit,
  UnitAttackedEvent,
  UnitDamagedEvent,
  UnitDefeatedEvent,
  UnitMovedEvent,
  ValidationResult,
} from "./types.js";
import { findPath, getReachablePositions } from "./pathfinding.js";
import { getDistance, hasLineOfSight, isAdjacent } from "./line-of-sight.js";

// =============================================================================
// State Management (Immutable Updates)
// =============================================================================

function updateUnit(
  units: ReadonlyArray<Unit>,
  unitId: string,
  updates: Partial<Unit>
): Unit[] {
  return units.map(u =>
    u.id === unitId ? { ...u, ...updates } : u
  );
}

function updateUnitStats(
  units: ReadonlyArray<Unit>,
  unitId: string,
  statsUpdates: Partial<Unit["stats"]>
): Unit[] {
  return units.map(u =>
    u.id === unitId
      ? { ...u, stats: { ...u.stats, ...statsUpdates } }
      : u
  );
}

// =============================================================================
// Initiative System
// =============================================================================

/**
 * Roll initiative for all units and create sorted order.
 * Uses a seeded random for determinism if seed is provided.
 */
export function rollInitiative(
  units: ReadonlyArray<Unit>,
  seed?: number
): InitiativeEntry[] {
  // Simple seeded RNG for determinism
  const random = seed !== undefined ? seededRandom(seed) : Math.random;

  const entries: InitiativeEntry[] = units
    .filter(u => u.stats.hp > 0)
    .map(unit => ({
      unitId: unit.id,
      roll: unit.stats.initiative + Math.floor(random() * 20) + 1,
    }));

  // Sort by roll (descending), then by unit ID for consistency
  return entries.sort((a, b) => {
    if (b.roll !== a.roll) return b.roll - a.roll;
    return a.unitId.localeCompare(b.unitId);
  });
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// =============================================================================
// Combat State Transitions
// =============================================================================

/**
 * Start combat with the given units.
 * Returns new game state and events generated.
 */
export function startCombat(
  state: GameState,
  seed?: number
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const timestamp = Date.now();

  const initiativeOrder = rollInitiative(state.units, seed);

  const combatStarted: CombatStartedEvent = {
    type: "combat_started",
    timestamp,
    round: 1,
    initiativeOrder,
  };
  events.push(combatStarted);

  const combat: CombatState = {
    phase: "in_progress",
    round: 1,
    initiativeOrder,
    currentTurnIndex: 0,
    turnState: null,
  };

  let newState: GameState = {
    ...state,
    combat,
    turnHistory: [...state.turnHistory, combatStarted],
  };

  // Start the first turn
  const turnResult = startTurn(newState);
  newState = turnResult.state;
  events.push(...turnResult.events);

  return { state: newState, events };
}

/**
 * Start the current unit's turn.
 */
function startTurn(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const { combat } = state;

  // Check for round start
  if (combat.currentTurnIndex === 0) {
    const roundStarted: RoundStartedEvent = {
      type: "round_started",
      timestamp: Date.now(),
      round: combat.round,
    };
    events.push(roundStarted);
  }

  const currentEntry = combat.initiativeOrder[combat.currentTurnIndex];
  if (!currentEntry) {
    throw new Error("Invalid turn index");
  }

  const unit = state.units.find(u => u.id === currentEntry.unitId);
  if (!unit || unit.stats.hp <= 0) {
    // Skip dead units - advance to next
    return advanceTurn(state);
  }

  const turnStarted: TurnStartedEvent = {
    type: "turn_started",
    timestamp: Date.now(),
    round: combat.round,
    unitId: unit.id,
  };
  events.push(turnStarted);

  const turnState: TurnState = {
    unitId: unit.id,
    phase: "move",
    movementRemaining: unit.stats.moveRange,
    hasActed: false,
  };

  const newState: GameState = {
    ...state,
    combat: { ...combat, turnState },
    turnHistory: [...state.turnHistory, ...events],
  };

  return { state: newState, events };
}

/**
 * Advance to the next turn in initiative order.
 */
function advanceTurn(state: GameState): { state: GameState; events: GameEvent[] } {
  const { combat } = state;
  let nextIndex = combat.currentTurnIndex + 1;
  let nextRound = combat.round;

  // Wrap around to next round if needed
  if (nextIndex >= combat.initiativeOrder.length) {
    nextIndex = 0;
    nextRound++;
  }

  const newCombat: CombatState = {
    ...combat,
    round: nextRound,
    currentTurnIndex: nextIndex,
    turnState: null,
  };

  const newState: GameState = {
    ...state,
    combat: newCombat,
  };

  return startTurn(newState);
}

// =============================================================================
// Action Validation
// =============================================================================

export function validateAction(
  action: GameAction,
  state: GameState
): ValidationResult {
  const { combat, units } = state;

  if (combat.phase !== "in_progress") {
    return { valid: false, reason: "Combat is not in progress" };
  }

  if (!combat.turnState) {
    return { valid: false, reason: "No active turn" };
  }

  if (action.unitId !== combat.turnState.unitId) {
    return { valid: false, reason: "Not this unit's turn" };
  }

  const unit = units.find(u => u.id === action.unitId);
  if (!unit) {
    return { valid: false, reason: "Unit not found" };
  }

  switch (action.type) {
    case "move":
      return validateMoveAction(action, unit, combat.turnState, state);
    case "attack":
      return validateAttackAction(action, unit, combat.turnState, state);
    case "end_turn":
      return { valid: true };
    default:
      return { valid: false, reason: "Unknown action type" };
  }
}

function validateMoveAction(
  action: MoveAction,
  unit: Unit,
  turnState: TurnState,
  state: GameState
): ValidationResult {
  if (turnState.phase === "ended") {
    return { valid: false, reason: "Turn has already ended" };
  }

  if (action.path.length === 0) {
    return { valid: false, reason: "Path is empty" };
  }

  // Verify path starts at current position
  const start = action.path[0];
  if (!start || start.x !== unit.position.x || start.y !== unit.position.y) {
    return { valid: false, reason: "Path must start at unit's current position" };
  }

  // Path length (excluding start) must be within movement remaining
  const pathCost = action.path.length - 1;
  if (pathCost > turnState.movementRemaining) {
    return {
      valid: false,
      reason: `Path requires ${pathCost} movement, only ${turnState.movementRemaining} remaining`,
    };
  }

  // Validate path is continuous and walkable
  const validPath = findPath(
    unit.position,
    action.path[action.path.length - 1]!,
    state.map,
    state.units,
    unit.id
  );

  if (!validPath) {
    return { valid: false, reason: "No valid path to destination" };
  }

  return { valid: true };
}

function validateAttackAction(
  action: AttackAction,
  unit: Unit,
  turnState: TurnState,
  state: GameState
): ValidationResult {
  if (turnState.hasActed) {
    return { valid: false, reason: "Already used action this turn" };
  }

  if (turnState.phase === "ended") {
    return { valid: false, reason: "Turn has already ended" };
  }

  const target = state.units.find(u => u.id === action.targetId);
  if (!target) {
    return { valid: false, reason: "Target not found" };
  }

  if (target.stats.hp <= 0) {
    return { valid: false, reason: "Target is already defeated" };
  }

  if (target.type === unit.type) {
    return { valid: false, reason: "Cannot attack friendly units" };
  }

  const distance = getDistance(unit.position, target.position);

  // Check attack range
  if (unit.stats.attackRange === 1) {
    // Melee attack
    if (!isAdjacent(unit.position, target.position)) {
      return { valid: false, reason: "Target not in melee range" };
    }
  } else {
    // Ranged attack
    if (distance > unit.stats.attackRange) {
      return { valid: false, reason: "Target out of range" };
    }

    // Check line of sight for ranged attacks
    if (!hasLineOfSight(unit.position, target.position, state.map)) {
      return { valid: false, reason: "No line of sight to target" };
    }
  }

  return { valid: true };
}

// =============================================================================
// Action Execution
// =============================================================================

/**
 * Execute an action and return the new state plus generated events.
 * This is the main entry point for the simulation.
 */
export function executeAction(
  action: GameAction,
  state: GameState
): { state: GameState; events: GameEvent[] } {
  const validation = validateAction(action, state);
  if (!validation.valid) {
    throw new Error(`Invalid action: ${validation.reason}`);
  }

  switch (action.type) {
    case "move":
      return executeMoveAction(action, state);
    case "attack":
      return executeAttackAction(action, state);
    case "end_turn":
      return executeEndTurn(action, state);
  }
}

function executeMoveAction(
  action: MoveAction,
  state: GameState
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const unit = state.units.find(u => u.id === action.unitId)!;
  const pathCost = action.path.length - 1;
  const destination = action.path[action.path.length - 1]!;

  const moveEvent: UnitMovedEvent = {
    type: "unit_moved",
    timestamp: Date.now(),
    round: state.combat.round,
    unitId: action.unitId,
    from: unit.position,
    to: destination,
    path: action.path,
  };
  events.push(moveEvent);

  const newUnits = updateUnit(state.units, action.unitId, {
    position: destination,
  });

  const newTurnState: TurnState = {
    ...state.combat.turnState!,
    movementRemaining: state.combat.turnState!.movementRemaining - pathCost,
  };

  const newState: GameState = {
    ...state,
    units: newUnits,
    combat: {
      ...state.combat,
      turnState: newTurnState,
    },
    turnHistory: [...state.turnHistory, ...events],
  };

  return { state: newState, events };
}

function executeAttackAction(
  action: AttackAction,
  state: GameState
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const attacker = state.units.find(u => u.id === action.unitId)!;
  const target = state.units.find(u => u.id === action.targetId)!;

  // Attack event
  const attackEvent: UnitAttackedEvent = {
    type: "unit_attacked",
    timestamp: Date.now(),
    round: state.combat.round,
    attackerId: action.unitId,
    targetId: action.targetId,
  };
  events.push(attackEvent);

  // Calculate damage (simple formula for v1)
  const baseDamage = attacker.stats.attack;
  const mitigation = Math.floor(target.stats.defense / 2);
  const damage = Math.max(1, baseDamage - mitigation); // Always at least 1 damage

  const newHp = Math.max(0, target.stats.hp - damage);

  const damageEvent: UnitDamagedEvent = {
    type: "unit_damaged",
    timestamp: Date.now(),
    round: state.combat.round,
    unitId: action.targetId,
    damage,
    remainingHp: newHp,
  };
  events.push(damageEvent);

  let newUnits = updateUnitStats(state.units, action.targetId, { hp: newHp });

  // Check for defeat
  if (newHp <= 0) {
    const defeatEvent: UnitDefeatedEvent = {
      type: "unit_defeated",
      timestamp: Date.now(),
      round: state.combat.round,
      unitId: action.targetId,
    };
    events.push(defeatEvent);
  }

  const newTurnState: TurnState = {
    ...state.combat.turnState!,
    hasActed: true,
    phase: "action",
  };

  let newState: GameState = {
    ...state,
    units: newUnits,
    combat: {
      ...state.combat,
      turnState: newTurnState,
    },
    turnHistory: [...state.turnHistory, ...events],
  };

  // Check win/lose conditions
  const combatEndResult = checkCombatEnd(newState);
  if (combatEndResult) {
    const endResult = endCombat(newState, combatEndResult);
    newState = endResult.state;
    events.push(...endResult.events);
  }

  return { state: newState, events };
}

function executeEndTurn(
  action: EndTurnAction,
  state: GameState
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  const turnEndedEvent: TurnEndedEvent = {
    type: "turn_ended",
    timestamp: Date.now(),
    round: state.combat.round,
    unitId: action.unitId,
  };
  events.push(turnEndedEvent);

  const stateWithEvent: GameState = {
    ...state,
    turnHistory: [...state.turnHistory, turnEndedEvent],
  };

  // Advance to next turn
  const nextTurnResult = advanceTurn(stateWithEvent);

  return {
    state: nextTurnResult.state,
    events: [...events, ...nextTurnResult.events],
  };
}

// =============================================================================
// Win/Lose Conditions
// =============================================================================

function checkCombatEnd(state: GameState): "victory" | "defeat" | null {
  const playerAlive = state.units.some(
    u => u.type === "player" && u.stats.hp > 0
  );
  const monstersAlive = state.units.some(
    u => u.type === "monster" && u.stats.hp > 0
  );

  if (!playerAlive) {
    return "defeat";
  }

  if (!monstersAlive) {
    return "victory";
  }

  return null;
}

function endCombat(
  state: GameState,
  result: "victory" | "defeat"
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  const combatEndedEvent: CombatEndedEvent = {
    type: "combat_ended",
    timestamp: Date.now(),
    round: state.combat.round,
    result,
  };
  events.push(combatEndedEvent);

  const newCombat: CombatState = {
    ...state.combat,
    phase: result === "victory" ? "victory" : "defeat",
    turnState: null,
  };

  const newState: GameState = {
    ...state,
    combat: newCombat,
    turnHistory: [...state.turnHistory, combatEndedEvent],
  };

  return { state: newState, events };
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * Get valid move targets for the current unit.
 */
export function getValidMoveTargets(state: GameState): Position[] {
  const { combat, units, map } = state;

  if (!combat.turnState || combat.phase !== "in_progress") {
    return [];
  }

  const unit = units.find(u => u.id === combat.turnState!.unitId);
  if (!unit) return [];

  const reachable = getReachablePositions(
    unit.position,
    combat.turnState.movementRemaining,
    map,
    units,
    unit.id
  );

  return Array.from(reachable.keys()).map(key => {
    const [x, y] = key.split(",").map(Number);
    return { x: x!, y: y! };
  });
}

/**
 * Get valid attack targets for the current unit.
 */
export function getValidAttackTargets(state: GameState): Unit[] {
  const { combat, units, map } = state;

  if (!combat.turnState || combat.phase !== "in_progress") {
    return [];
  }

  if (combat.turnState.hasActed) {
    return [];
  }

  const unit = units.find(u => u.id === combat.turnState!.unitId);
  if (!unit) return [];

  return units.filter(target => {
    if (target.id === unit.id) return false;
    if (target.type === unit.type) return false;
    if (target.stats.hp <= 0) return false;

    const distance = getDistance(unit.position, target.position);

    if (unit.stats.attackRange === 1) {
      return isAdjacent(unit.position, target.position);
    }

    if (distance > unit.stats.attackRange) return false;

    return hasLineOfSight(unit.position, target.position, map);
  });
}
