/**
 * Tests for the combat simulation engine.
 */

import { describe, expect, test } from "bun:test";
import {
  generateGameState,
  startCombat,
  executeAction,
  validateAction,
  getValidMoveTargets,
  getValidAttackTargets,
  findPath,
  hasLineOfSight,
} from "./index.js";

describe("Map Generation", () => {
  test("generates a map with correct dimensions", () => {
    const state = generateGameState({ seed: 12345, mapWidth: 20, mapHeight: 20 });

    expect(state.map.size.width).toBe(20);
    expect(state.map.size.height).toBe(20);
    expect(state.map.tiles.length).toBe(20);
    expect(state.map.tiles[0]!.length).toBe(20);
  });

  test("generates deterministic maps with same seed", () => {
    const state1 = generateGameState({ seed: 12345 });
    const state2 = generateGameState({ seed: 12345 });

    expect(state1.map.tiles).toEqual(state2.map.tiles);
    expect(state1.units.map(u => u.position)).toEqual(
      state2.units.map(u => u.position)
    );
  });

  test("generates different maps with different seeds", () => {
    const state1 = generateGameState({ seed: 12345 });
    const state2 = generateGameState({ seed: 54321 });

    // Maps should be different (with high probability)
    expect(state1.map.id).not.toBe(state2.map.id);
  });
});

describe("Unit Generation", () => {
  test("generates correct number of units", () => {
    const state = generateGameState({ seed: 12345, monsterCount: 3 });

    expect(state.units.length).toBe(4); // 1 player + 3 monsters
    expect(state.units.filter(u => u.type === "player").length).toBe(1);
    expect(state.units.filter(u => u.type === "monster").length).toBe(3);
  });

  test("player and monsters have valid stats", () => {
    const state = generateGameState({ seed: 12345 });

    for (const unit of state.units) {
      expect(unit.stats.hp).toBeGreaterThan(0);
      expect(unit.stats.maxHp).toBeGreaterThan(0);
      expect(unit.stats.hp).toBeLessThanOrEqual(unit.stats.maxHp);
      expect(unit.stats.attack).toBeGreaterThan(0);
      expect(unit.stats.moveRange).toBeGreaterThan(0);
    }
  });
});

describe("Combat Initialization", () => {
  test("starts combat and rolls initiative", () => {
    const state = generateGameState({ seed: 12345 });
    const { state: combatState, events } = startCombat(state, 12345);

    expect(combatState.combat.phase).toBe("in_progress");
    expect(combatState.combat.round).toBe(1);
    expect(combatState.combat.initiativeOrder.length).toBe(4);

    // Should have combat_started event
    expect(events.some(e => e.type === "combat_started")).toBe(true);
    // Should have turn_started event
    expect(events.some(e => e.type === "turn_started")).toBe(true);
  });

  test("initiative order is deterministic with same seed", () => {
    const state1 = generateGameState({ seed: 12345 });
    const state2 = generateGameState({ seed: 12345 });

    const { state: combat1 } = startCombat(state1, 12345);
    const { state: combat2 } = startCombat(state2, 12345);

    expect(combat1.combat.initiativeOrder).toEqual(combat2.combat.initiativeOrder);
  });
});

describe("Pathfinding", () => {
  test("finds path on empty map", () => {
    const state = generateGameState({ seed: 12345, wallDensity: 0 });
    const start = state.units[0]!.position;
    const goal = { x: start.x + 2, y: start.y };

    const path = findPath(start, goal, state.map, state.units, state.units[0]!.id);

    expect(path).not.toBeNull();
    expect(path!.length).toBe(3); // start + 2 moves
    expect(path![0]).toEqual(start);
    expect(path![path!.length - 1]).toEqual(goal);
  });

  test("returns null for unreachable positions", () => {
    const state = generateGameState({ seed: 12345 });
    const start = state.units[0]!.position;
    // Wall position (border)
    const goal = { x: 0, y: 0 };

    const path = findPath(start, goal, state.map, state.units, state.units[0]!.id);

    expect(path).toBeNull();
  });
});

describe("Line of Sight", () => {
  test("has LoS to adjacent tile", () => {
    const state = generateGameState({ seed: 12345, wallDensity: 0 });
    const from = { x: 5, y: 5 };
    const to = { x: 6, y: 5 };

    expect(hasLineOfSight(from, to, state.map)).toBe(true);
  });

  test("same position always has LoS", () => {
    const state = generateGameState({ seed: 12345 });
    const pos = { x: 5, y: 5 };

    expect(hasLineOfSight(pos, pos, state.map)).toBe(true);
  });
});

describe("Action Validation", () => {
  test("rejects actions when combat not in progress", () => {
    const state = generateGameState({ seed: 12345 });
    // Combat not started

    const result = validateAction(
      { type: "end_turn", unitId: "player-1" },
      state
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not in progress");
  });

  test("rejects actions from wrong unit", () => {
    const state = generateGameState({ seed: 12345 });
    const { state: combatState } = startCombat(state, 12345);

    const currentUnitId = combatState.combat.turnState!.unitId;
    const wrongUnitId = combatState.units.find(u => u.id !== currentUnitId)!.id;

    const result = validateAction(
      { type: "end_turn", unitId: wrongUnitId },
      combatState
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Not this unit's turn");
  });
});

describe("Action Execution", () => {
  test("end turn advances to next unit", () => {
    const state = generateGameState({ seed: 12345 });
    const { state: combatState } = startCombat(state, 12345);

    const firstUnitId = combatState.combat.turnState!.unitId;

    const { state: newState, events } = executeAction(
      { type: "end_turn", unitId: firstUnitId },
      combatState
    );

    expect(newState.combat.turnState!.unitId).not.toBe(firstUnitId);
    expect(events.some(e => e.type === "turn_ended")).toBe(true);
    expect(events.some(e => e.type === "turn_started")).toBe(true);
  });
});

describe("Valid Targets", () => {
  test("returns valid move targets within range", () => {
    const state = generateGameState({ seed: 12345, wallDensity: 0 });
    const { state: combatState } = startCombat(state, 12345);

    const moveTargets = getValidMoveTargets(combatState);

    expect(moveTargets.length).toBeGreaterThan(0);

    // All targets should be within move range
    const currentUnit = combatState.units.find(
      u => u.id === combatState.combat.turnState!.unitId
    )!;

    for (const target of moveTargets) {
      const distance =
        Math.abs(target.x - currentUnit.position.x) +
        Math.abs(target.y - currentUnit.position.y);
      expect(distance).toBeLessThanOrEqual(currentUnit.stats.moveRange);
    }
  });
});
