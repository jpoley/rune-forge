/**
 * Database Migrations
 *
 * Version-controlled schema migrations for the multiplayer database.
 * Each migration has an up() function that applies changes.
 */

import { Database } from "bun:sqlite";
import { SCHEMA_SQL, tableExists } from "./schema.js";

/**
 * Migration definition.
 */
interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

/**
 * All migrations in order.
 * New migrations should be added at the end with incrementing version numbers.
 */
/**
 * Parse SQL statements, handling comments and multi-line statements.
 */
function parseSqlStatements(sql: string): string[] {
  // Remove SQL comments (both -- and /* */ style)
  const withoutComments = sql
    .replace(/--[^\n]*/g, "") // Remove -- comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // Remove /* */ comments

  // Split by semicolons and filter empty statements
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_multiplayer_schema",
    up: (db: Database) => {
      // Parse and execute each statement from the schema
      const statements = parseSqlStatements(SCHEMA_SQL);

      for (const statement of statements) {
        db.run(statement);
      }
    },
  },
  // Future migrations go here:
  // {
  //   version: 2,
  //   name: "add_player_achievements",
  //   up: (db: Database) => {
  //     db.run(`
  //       CREATE TABLE IF NOT EXISTS achievements (
  //         id TEXT PRIMARY KEY,
  //         user_id TEXT NOT NULL,
  //         type TEXT NOT NULL,
  //         unlocked_at INTEGER NOT NULL,
  //         FOREIGN KEY (user_id) REFERENCES users(id)
  //       )
  //     `);
  //   },
  // },
];

/**
 * Create the migrations tracking table if it doesn't exist.
 */
function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

/**
 * Get the current schema version.
 */
export function getCurrentVersion(db: Database): number {
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

/**
 * Get list of applied migrations.
 */
export function getAppliedMigrations(
  db: Database
): { version: number; name: string; applied_at: number }[] {
  if (!tableExists(db, "schema_migrations")) {
    return [];
  }

  return db
    .query<
      { version: number; name: string; applied_at: number },
      []
    >("SELECT version, name, applied_at FROM schema_migrations ORDER BY version")
    .all();
}

/**
 * Run all pending migrations.
 *
 * @returns Number of migrations applied
 */
export function runMigrations(db: Database): number {
  ensureMigrationsTable(db);

  const currentVersion = getCurrentVersion(db);
  const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    console.log("[db] Schema is up to date (version " + currentVersion + ")");
    return 0;
  }

  console.log(
    `[db] Running ${pendingMigrations.length} migration(s) from version ${currentVersion}...`
  );

  let applied = 0;

  for (const migration of pendingMigrations) {
    console.log(`[db] Applying migration ${migration.version}: ${migration.name}`);

    try {
      // Run migration in a transaction
      db.run("BEGIN TRANSACTION");

      migration.up(db);

      // Record migration
      db.run(
        "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
        [migration.version, migration.name]
      );

      db.run("COMMIT");
      applied++;

      console.log(`[db] Migration ${migration.version} applied successfully`);
    } catch (error) {
      db.run("ROLLBACK");
      console.error(`[db] Migration ${migration.version} failed:`, error);
      throw error;
    }
  }

  console.log(`[db] Applied ${applied} migration(s). Now at version ${getCurrentVersion(db)}`);

  return applied;
}

/**
 * Check if migrations are needed.
 */
export function needsMigration(db: Database): boolean {
  const currentVersion = getCurrentVersion(db);
  const latestVersion = MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1]!.version : 0;
  return currentVersion < latestVersion;
}

/**
 * Get the latest available schema version.
 */
export function getLatestVersion(): number {
  return MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1]!.version : 0;
}
