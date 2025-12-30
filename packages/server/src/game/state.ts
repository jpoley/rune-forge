/**
 * Game State Management
 *
 * In-memory game state for active sessions.
 */

import type { GameState } from "@rune-forge/simulation";
import type { Session, SessionConfig } from "../db/index.js";

/**
 * In-memory representation of an active game session.
 */
export interface GameSessionState {
  id: string;
  joinCode: string;
  dmUserId: string;
  status: "lobby" | "playing" | "paused" | "ended";
  config: SessionConfig;

  /** Game state from simulation (null until game starts) */
  gameState: GameState | null;

  /** Monotonically increasing state version for sync */
  stateVersion: number;

  /** Event log for the current session */
  eventLog: unknown[];

  /** Timestamps */
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;

  /** Turn management */
  currentTurnUserId: string | null;
  turnStartedAt: number | null;
  turnTimeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Create in-memory game state from database session.
 */
export function createGameState(dbSession: Session): GameSessionState {
  return {
    id: dbSession.id,
    joinCode: dbSession.joinCode,
    dmUserId: dbSession.dmUserId,
    status: dbSession.status,
    config: dbSession.config,
    gameState: dbSession.gameState,
    stateVersion: dbSession.stateVersion,
    eventLog: dbSession.eventLog,
    createdAt: dbSession.createdAt * 1000,
    startedAt: dbSession.startedAt ? dbSession.startedAt * 1000 : null,
    endedAt: dbSession.endedAt ? dbSession.endedAt * 1000 : null,
    currentTurnUserId: null,
    turnStartedAt: null,
    turnTimeoutId: null,
  };
}

/**
 * State delta for incremental sync.
 */
export interface StateDelta {
  fromVersion: number;
  toVersion: number;
  changes: StateChange[];
}

/**
 * A single change in the state.
 */
export interface StateChange {
  path: string;
  value: unknown;
}

/**
 * Apply a delta to game state.
 * Used on client side; server always has authoritative state.
 */
export function applyDelta(state: GameState, delta: StateDelta): GameState {
  // Deep clone the state
  const newState = JSON.parse(JSON.stringify(state)) as GameState;

  for (const change of delta.changes) {
    setValueAtPath(newState, change.path, change.value);
  }

  return newState;
}

/**
 * Set a value at a dot-separated path in an object.
 */
function setValueAtPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const index = parseInt(part, 10);

    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index] as Record<string, unknown>;
    } else {
      current = current[part] as Record<string, unknown>;
    }
  }

  const lastPart = parts[parts.length - 1]!;
  const lastIndex = parseInt(lastPart, 10);

  if (!isNaN(lastIndex) && Array.isArray(current)) {
    (current as unknown[])[lastIndex] = value;
  } else {
    current[lastPart] = value;
  }
}

/**
 * Create a delta between two states.
 */
export function createDelta(
  oldState: GameState,
  newState: GameState,
  fromVersion: number,
  toVersion: number
): StateDelta {
  const changes: StateChange[] = [];

  // Compare units
  if (JSON.stringify(oldState.units) !== JSON.stringify(newState.units)) {
    changes.push({ path: "units", value: newState.units });
  }

  // Compare combat state
  if (JSON.stringify(oldState.combat) !== JSON.stringify(newState.combat)) {
    changes.push({ path: "combat", value: newState.combat });
  }

  // Compare loot
  if (JSON.stringify(oldState.loot) !== JSON.stringify(newState.loot)) {
    changes.push({ path: "loot", value: newState.loot });
  }

  // Compare inventory
  if (JSON.stringify(oldState.playerInventory) !== JSON.stringify(newState.playerInventory)) {
    changes.push({ path: "playerInventory", value: newState.playerInventory });
  }

  return {
    fromVersion,
    toVersion,
    changes,
  };
}
