/**
 * Session Database Operations
 *
 * Handles game session CRUD operations including player management.
 */

import type { Database } from "bun:sqlite";
import type { GameState } from "@rune-forge/simulation";

/**
 * Session status values.
 */
export type SessionStatus = "lobby" | "playing" | "paused" | "ended";

/**
 * Session configuration.
 */
export interface SessionConfig {
  maxPlayers: number;
  mapSeed: number;
  difficulty: "easy" | "normal" | "hard";
  turnTimeLimit: number;
  monsterCount: number;
  playerMoveRange: number;
  allowLateJoin: boolean;
  /** Number of NPC party members */
  npcCount: number;
  /** Classes for NPC party members */
  npcClasses: string[];
}

/**
 * Session player status.
 */
export type PlayerStatus = "connected" | "disconnected" | "spectating";

/**
 * Session player record.
 */
export interface DbSessionPlayer {
  session_id: string;
  user_id: string;
  character_id: string;
  unit_id: string | null;
  status: PlayerStatus;
  is_ready: number;
  joined_at: number;
  last_seen_at: number;
}

/**
 * Session record from database.
 */
export interface DbSession {
  id: string;
  join_code: string;
  dm_user_id: string;
  status: SessionStatus;
  config: string; // JSON
  game_state: string | null; // JSON
  state_version: number;
  event_log: string; // JSON
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

/**
 * Parsed session with typed fields.
 */
export interface Session {
  id: string;
  joinCode: string;
  dmUserId: string;
  status: SessionStatus;
  config: SessionConfig;
  gameState: GameState | null;
  stateVersion: number;
  eventLog: unknown[];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

/**
 * Session player (parsed).
 */
export interface SessionPlayer {
  sessionId: string;
  userId: string;
  characterId: string;
  unitId: string | null;
  status: PlayerStatus;
  isReady: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

/**
 * Convert database record to typed session.
 */
function toSession(row: DbSession): Session {
  return {
    id: row.id,
    joinCode: row.join_code,
    dmUserId: row.dm_user_id,
    status: row.status,
    config: JSON.parse(row.config) as SessionConfig,
    gameState: row.game_state ? (JSON.parse(row.game_state) as GameState) : null,
    stateVersion: row.state_version,
    eventLog: JSON.parse(row.event_log) as unknown[],
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

/**
 * Convert database record to typed session player.
 */
function toSessionPlayer(row: DbSessionPlayer): SessionPlayer {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    characterId: row.character_id,
    unitId: row.unit_id,
    status: row.status,
    isReady: row.is_ready === 1,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Generate a 6-character join code.
 * Uses characters that are easy to read (no I, O, 0, 1).
 */
function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Session database operations.
 */
export class SessionRepository {
  constructor(private db: Database) {}

  /**
   * Find a session by ID.
   */
  findById(id: string): Session | null {
    const row = this.db
      .query<DbSession, [string]>("SELECT * FROM sessions WHERE id = ?")
      .get(id);

    return row ? toSession(row) : null;
  }

  /**
   * Find a session by join code.
   */
  findByJoinCode(joinCode: string): Session | null {
    const row = this.db
      .query<DbSession, [string]>(
        "SELECT * FROM sessions WHERE join_code = ? AND status != 'ended'"
      )
      .get(joinCode.toUpperCase());

    return row ? toSession(row) : null;
  }

  /**
   * Find active sessions for a user (as DM or player).
   */
  findActiveByUserId(userId: string): Session[] {
    const rows = this.db
      .query<DbSession, [string, string]>(
        `SELECT DISTINCT s.* FROM sessions s
         LEFT JOIN session_players sp ON s.id = sp.session_id
         WHERE (s.dm_user_id = ? OR sp.user_id = ?)
           AND s.status != 'ended'
         ORDER BY s.created_at DESC`
      )
      .all(userId, userId);

    return rows.map(toSession);
  }

  /**
   * Create a new game session.
   */
  create(
    id: string,
    dmUserId: string,
    config: Partial<SessionConfig>
  ): Session {
    const now = Math.floor(Date.now() / 1000);

    // Generate unique join code
    let joinCode: string;
    let attempts = 0;
    do {
      joinCode = generateJoinCode();
      attempts++;
      if (attempts > 10) {
        throw new Error("Failed to generate unique join code");
      }
    } while (this.findByJoinCode(joinCode) !== null);

    // Merge with defaults
    const fullConfig: SessionConfig = {
      maxPlayers: config.maxPlayers ?? 4,
      mapSeed: config.mapSeed ?? Math.floor(Math.random() * 1000000),
      difficulty: config.difficulty ?? "normal",
      turnTimeLimit: config.turnTimeLimit ?? 0,
      monsterCount: config.monsterCount ?? 3,
      playerMoveRange: config.playerMoveRange ?? 3,
      allowLateJoin: config.allowLateJoin ?? false,
      npcCount: config.npcCount ?? 0,
      npcClasses: config.npcClasses ?? [],
    };

    this.db.run(
      `INSERT INTO sessions (
        id, join_code, dm_user_id, status, config, game_state, state_version, event_log, created_at
      ) VALUES (?, ?, ?, 'lobby', ?, NULL, 0, '[]', ?)`,
      [id, joinCode, dmUserId, JSON.stringify(fullConfig), now]
    );

    return this.findById(id)!;
  }

  /**
   * Update session status.
   */
  updateStatus(id: string, status: SessionStatus): void {
    const now = Math.floor(Date.now() / 1000);

    if (status === "playing") {
      this.db.run(
        "UPDATE sessions SET status = ?, started_at = ? WHERE id = ?",
        [status, now, id]
      );
    } else if (status === "ended") {
      this.db.run(
        "UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?",
        [status, now, id]
      );
    } else {
      this.db.run("UPDATE sessions SET status = ? WHERE id = ?", [status, id]);
    }
  }

  /**
   * Update game state.
   */
  updateGameState(id: string, gameState: GameState, version: number): void {
    this.db.run(
      "UPDATE sessions SET game_state = ?, state_version = ? WHERE id = ?",
      [JSON.stringify(gameState), version, id]
    );
  }

  /**
   * Append events to the event log.
   */
  appendEvents(id: string, events: unknown[]): void {
    const session = this.findById(id);
    if (!session) return;

    const newLog = [...session.eventLog, ...events];
    this.db.run("UPDATE sessions SET event_log = ? WHERE id = ?", [
      JSON.stringify(newLog),
      id,
    ]);
  }

  /**
   * Delete a session.
   */
  delete(id: string): boolean {
    const result = this.db.run("DELETE FROM sessions WHERE id = ?", [id]);
    return result.changes > 0;
  }

  // =========================================================================
  // Session Players
  // =========================================================================

  /**
   * Get all players in a session.
   */
  getPlayers(sessionId: string): SessionPlayer[] {
    const rows = this.db
      .query<DbSessionPlayer, [string]>(
        "SELECT * FROM session_players WHERE session_id = ? ORDER BY joined_at"
      )
      .all(sessionId);

    return rows.map(toSessionPlayer);
  }

  /**
   * Get a specific player in a session.
   */
  getPlayer(sessionId: string, userId: string): SessionPlayer | null {
    const row = this.db
      .query<DbSessionPlayer, [string, string]>(
        "SELECT * FROM session_players WHERE session_id = ? AND user_id = ?"
      )
      .get(sessionId, userId);

    return row ? toSessionPlayer(row) : null;
  }

  /**
   * Add a player to a session.
   */
  addPlayer(
    sessionId: string,
    userId: string,
    characterId: string
  ): SessionPlayer {
    const now = Math.floor(Date.now() / 1000);

    this.db.run(
      `INSERT INTO session_players (
        session_id, user_id, character_id, unit_id, status, is_ready, joined_at, last_seen_at
      ) VALUES (?, ?, ?, NULL, 'connected', 0, ?, ?)`,
      [sessionId, userId, characterId, now, now]
    );

    return this.getPlayer(sessionId, userId)!;
  }

  /**
   * Remove a player from a session.
   */
  removePlayer(sessionId: string, userId: string): boolean {
    const result = this.db.run(
      "DELETE FROM session_players WHERE session_id = ? AND user_id = ?",
      [sessionId, userId]
    );
    return result.changes > 0;
  }

  /**
   * Update player ready status.
   */
  updatePlayerReady(
    sessionId: string,
    userId: string,
    isReady: boolean
  ): void {
    this.db.run(
      "UPDATE session_players SET is_ready = ? WHERE session_id = ? AND user_id = ?",
      [isReady ? 1 : 0, sessionId, userId]
    );
  }

  /**
   * Update player connection status.
   */
  updatePlayerStatus(
    sessionId: string,
    userId: string,
    status: PlayerStatus
  ): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      "UPDATE session_players SET status = ?, last_seen_at = ? WHERE session_id = ? AND user_id = ?",
      [status, now, sessionId, userId]
    );
  }

  /**
   * Update player's last seen timestamp.
   */
  updatePlayerLastSeen(sessionId: string, userId: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      "UPDATE session_players SET last_seen_at = ? WHERE session_id = ? AND user_id = ?",
      [now, sessionId, userId]
    );
  }

  /**
   * Assign unit IDs to players when game starts.
   */
  assignUnitId(sessionId: string, userId: string, unitId: string): void {
    this.db.run(
      "UPDATE session_players SET unit_id = ? WHERE session_id = ? AND user_id = ?",
      [unitId, sessionId, userId]
    );
  }

  /**
   * Get player count in a session.
   */
  getPlayerCount(sessionId: string): number {
    const result = this.db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM session_players WHERE session_id = ?"
      )
      .get(sessionId);

    return result?.count ?? 0;
  }

  /**
   * Check if all players are ready.
   */
  allPlayersReady(sessionId: string): boolean {
    const result = this.db
      .query<{ not_ready: number }, [string]>(
        "SELECT COUNT(*) as not_ready FROM session_players WHERE session_id = ? AND is_ready = 0"
      )
      .get(sessionId);

    return (result?.not_ready ?? 1) === 0;
  }

  /**
   * Check if a user is in a session.
   */
  isPlayerInSession(sessionId: string, userId: string): boolean {
    const result = this.db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) as count FROM session_players WHERE session_id = ? AND user_id = ?"
      )
      .get(sessionId, userId);

    return (result?.count ?? 0) > 0;
  }

  /**
   * Find which session a user is currently in (if any).
   */
  findUserActiveSession(userId: string): Session | null {
    const row = this.db
      .query<DbSession, [string]>(
        `SELECT s.* FROM sessions s
         JOIN session_players sp ON s.id = sp.session_id
         WHERE sp.user_id = ? AND s.status != 'ended'
         LIMIT 1`
      )
      .get(userId);

    return row ? toSession(row) : null;
  }
}
