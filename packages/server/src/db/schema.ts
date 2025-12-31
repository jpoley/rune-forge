/**
 * Database Schema
 *
 * Defines all table schemas for the multiplayer game database.
 * Uses SQLite with Bun's native driver.
 */

import { Database } from "bun:sqlite";

/**
 * SQL statements for creating all tables.
 * Order matters due to foreign key constraints.
 */
export const SCHEMA_SQL = `
-- Users table (synced from Pocket ID on login)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- Pocket ID subject (sub claim)
  display_name TEXT NOT NULL,
  email TEXT,
  ip_address TEXT,                        -- IP address from last login
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Characters table (persona + progression)
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,                    -- UUID (client-generated)
  user_id TEXT NOT NULL,

  -- Persona (client-owned, synced from client)
  name TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('warrior', 'ranger', 'mage', 'rogue')),
  appearance TEXT NOT NULL,               -- JSON: { bodyType, skinTone, hairColor, hairStyle, facialHair? }
  backstory TEXT,                         -- Optional flavor text (max 1000 chars)

  -- Progression (server-owned, never from client)
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER GENERATED ALWAYS AS (xp / 1000 + 1) STORED,
  gold INTEGER NOT NULL DEFAULT 0,
  silver INTEGER NOT NULL DEFAULT 0,
  inventory TEXT NOT NULL DEFAULT '{"weapons":[],"equippedWeaponId":null}',

  -- Lifetime stats
  games_played INTEGER NOT NULL DEFAULT 0,
  monsters_killed INTEGER NOT NULL DEFAULT 0,
  damage_dealt INTEGER NOT NULL DEFAULT 0,
  damage_taken INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);

-- Game sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                    -- UUID
  join_code TEXT NOT NULL UNIQUE,         -- 6-char alphanumeric (e.g., "ABC123")
  dm_user_id TEXT NOT NULL,               -- Creator is the DM

  status TEXT NOT NULL DEFAULT 'lobby'
    CHECK (status IN ('lobby', 'playing', 'paused', 'ended')),

  -- Configuration (JSON)
  config TEXT NOT NULL,                   -- JSON: { maxPlayers, mapSeed, difficulty, turnTimeLimit, monsterCount, allowLateJoin }

  -- Game state (null until game starts)
  game_state TEXT,                        -- JSON: GameState from simulation
  state_version INTEGER NOT NULL DEFAULT 0,

  -- Event log for replay/audit
  event_log TEXT NOT NULL DEFAULT '[]',   -- JSON: GameEvent[]

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  ended_at INTEGER,

  FOREIGN KEY (dm_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_join_code ON sessions(join_code);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_dm ON sessions(dm_user_id);

-- Session players junction table
CREATE TABLE IF NOT EXISTS session_players (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,

  unit_id TEXT,                           -- In-game unit ID (assigned when game starts)
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'spectating')),
  is_ready INTEGER NOT NULL DEFAULT 0,    -- 0 = false, 1 = true

  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),

  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (character_id) REFERENCES characters(id)
);

CREATE INDEX IF NOT EXISTS idx_session_players_user ON session_players(user_id);
CREATE INDEX IF NOT EXISTS idx_session_players_character ON session_players(character_id);

-- Session archives (for replays and statistics)
CREATE TABLE IF NOT EXISTS session_archives (
  id TEXT PRIMARY KEY,                    -- Same as original session ID
  dm_user_id TEXT NOT NULL,
  config TEXT NOT NULL,                   -- JSON: SessionConfig
  final_state TEXT NOT NULL,              -- JSON: final GameState
  event_log TEXT NOT NULL,                -- JSON: complete GameEvent[]
  player_results TEXT NOT NULL,           -- JSON: GameRewards[]

  played_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,

  FOREIGN KEY (dm_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_archives_dm ON session_archives(dm_user_id);
CREATE INDEX IF NOT EXISTS idx_archives_played_at ON session_archives(played_at);

-- Single-player saves (migrated from original schema)
CREATE TABLE IF NOT EXISTS saves (
  slot INTEGER PRIMARY KEY CHECK (slot >= 1 AND slot <= 10),
  user_id TEXT,                           -- Optional: associate with user
  name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  version INTEGER NOT NULL,
  game_state TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_saves_user ON saves(user_id);
`;

/**
 * Initialize the database with all tables.
 * Note: Uses db.run() for multi-statement execution.
 */
export function initializeSchema(db: Database): void {
  // Split and execute each statement separately for compatibility
  const statements = SCHEMA_SQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const statement of statements) {
    db.run(statement);
  }
}

/**
 * Check if a table exists.
 */
export function tableExists(db: Database, tableName: string): boolean {
  const result = db
    .query<{ count: number }, [string]>(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?"
    )
    .get(tableName);
  return (result?.count ?? 0) > 0;
}

/**
 * Get current schema version from migrations table.
 */
export function getSchemaVersion(db: Database): number {
  // Check if migrations table exists
  if (!tableExists(db, "schema_migrations")) {
    return 0;
  }

  const result = db
    .query<{ version: number }, []>(
      "SELECT MAX(version) as version FROM schema_migrations"
    )
    .get();

  return result?.version ?? 0;
}
