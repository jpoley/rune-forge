/**
 * Database Module
 *
 * Provides database initialization, migrations, and repository access.
 * Database files are stored in .data/ for container mounting.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runMigrations, getCurrentVersion, getLatestVersion } from "./migrations.js";
import { UserRepository } from "./users.js";
import { CharacterRepository } from "./characters.js";
import { SessionRepository } from "./sessions.js";

// Re-export types
export * from "./users.js";
export * from "./characters.js";
export * from "./sessions.js";

/**
 * Default database path (relative to project root).
 * Uses .data/ directory for container mounting and backups.
 * Note: When running from packages/server, we go up two levels to project root.
 */
const DEFAULT_DB_PATH = "../../.data/rune-forge.db";

/**
 * Database instance with all repositories.
 */
export interface DatabaseInstance {
  db: Database;
  users: UserRepository;
  characters: CharacterRepository;
  sessions: SessionRepository;
  close: () => void;
}

let instance: DatabaseInstance | null = null;

/**
 * Get the database path, ensuring the directory exists.
 */
function getDbPath(customPath?: string): string {
  const dbPath = customPath ?? process.env.DB_PATH ?? DEFAULT_DB_PATH;
  const absolutePath = resolve(process.cwd(), dbPath);

  // Ensure directory exists
  const dir = dirname(absolutePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  return absolutePath;
}

/**
 * Initialize the database with migrations and repositories.
 */
export function initDatabase(customPath?: string): DatabaseInstance {
  if (instance) {
    return instance;
  }

  const dbPath = getDbPath(customPath);
  console.log(`[db] Opening database: ${dbPath}`);

  // Open database with WAL mode for better concurrency
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  // Run migrations
  const currentVersion = getCurrentVersion(db);
  const latestVersion = getLatestVersion();

  if (currentVersion < latestVersion) {
    console.log(`[db] Database version ${currentVersion} < ${latestVersion}, running migrations...`);
    runMigrations(db);
  } else {
    console.log(`[db] Database schema is up to date (version ${currentVersion})`);
  }

  // Create repositories
  const users = new UserRepository(db);
  const characters = new CharacterRepository(db);
  const sessions = new SessionRepository(db);

  instance = {
    db,
    users,
    characters,
    sessions,
    close: () => {
      db.close();
      instance = null;
      console.log("[db] Database closed");
    },
  };

  return instance;
}

/**
 * Get the current database instance.
 * Throws if not initialized.
 */
export function getDb(): DatabaseInstance {
  if (!instance) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return instance;
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  if (instance) {
    instance.close();
  }
}

/**
 * Check if database is initialized.
 */
export function isDbInitialized(): boolean {
  return instance !== null;
}
