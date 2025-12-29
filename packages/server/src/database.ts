/**
 * SQLite database layer for save game management.
 * Uses Bun's native SQLite support.
 */

import { Database } from "bun:sqlite";
import type { SaveData, SaveMetadata, GameState } from "@rune-forge/simulation";

const CURRENT_SAVE_VERSION = 1;
const MAX_SAVE_SLOTS = 10;

export class SaveDatabase {
  private db: Database;

  constructor(dbPath: string = "rune-forge.db") {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS saves (
        slot INTEGER PRIMARY KEY CHECK (slot >= 1 AND slot <= ${MAX_SAVE_SLOTS}),
        name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        version INTEGER NOT NULL,
        game_state TEXT NOT NULL
      )
    `);

    // Create index for quick slot lookups
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_saves_slot ON saves(slot)
    `);
  }

  /**
   * Save a game to a specific slot.
   * Overwrites any existing save in that slot.
   */
  save(slot: number, name: string, gameState: GameState): SaveMetadata {
    if (slot < 1 || slot > MAX_SAVE_SLOTS) {
      throw new Error(`Invalid save slot: ${slot}. Must be 1-${MAX_SAVE_SLOTS}`);
    }

    const timestamp = Date.now();
    const gameStateJson = JSON.stringify(gameState);

    this.db.run(
      `INSERT OR REPLACE INTO saves (slot, name, timestamp, version, game_state)
       VALUES (?, ?, ?, ?, ?)`,
      [slot, name, timestamp, CURRENT_SAVE_VERSION, gameStateJson]
    );

    return {
      slot,
      name,
      timestamp,
      version: CURRENT_SAVE_VERSION,
    };
  }

  /**
   * Load a save from a specific slot.
   * Returns null if the slot is empty.
   */
  load(slot: number): SaveData | null {
    if (slot < 1 || slot > MAX_SAVE_SLOTS) {
      throw new Error(`Invalid save slot: ${slot}. Must be 1-${MAX_SAVE_SLOTS}`);
    }

    const row = this.db
      .query<
        { slot: number; name: string; timestamp: number; version: number; game_state: string },
        [number]
      >("SELECT * FROM saves WHERE slot = ?")
      .get(slot);

    if (!row) {
      return null;
    }

    // Handle version migration if needed
    const gameState = this.migrateGameState(
      JSON.parse(row.game_state) as GameState,
      row.version
    );

    return {
      slot: row.slot,
      name: row.name,
      timestamp: row.timestamp,
      version: CURRENT_SAVE_VERSION,
      gameState,
    };
  }

  /**
   * Delete a save from a specific slot.
   */
  delete(slot: number): boolean {
    if (slot < 1 || slot > MAX_SAVE_SLOTS) {
      throw new Error(`Invalid save slot: ${slot}. Must be 1-${MAX_SAVE_SLOTS}`);
    }

    const result = this.db.run("DELETE FROM saves WHERE slot = ?", [slot]);
    return result.changes > 0;
  }

  /**
   * List all save slots with metadata.
   * Empty slots are represented as null in the array.
   */
  listSaves(): (SaveMetadata | null)[] {
    const saves: (SaveMetadata | null)[] = new Array(MAX_SAVE_SLOTS).fill(null);

    const rows = this.db
      .query<
        { slot: number; name: string; timestamp: number; version: number },
        []
      >("SELECT slot, name, timestamp, version FROM saves ORDER BY slot")
      .all();

    for (const row of rows) {
      saves[row.slot - 1] = {
        slot: row.slot,
        name: row.name,
        timestamp: row.timestamp,
        version: row.version,
      };
    }

    return saves;
  }

  /**
   * Migrate game state from an older version to current.
   * Add migration logic here as the save format evolves.
   */
  private migrateGameState(gameState: GameState, fromVersion: number): GameState {
    let migrated = gameState;

    // Example migration pattern:
    // if (fromVersion < 2) {
    //   migrated = migrateV1ToV2(migrated);
    // }
    // if (fromVersion < 3) {
    //   migrated = migrateV2ToV3(migrated);
    // }

    return migrated;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// Singleton instance for the application
let dbInstance: SaveDatabase | null = null;

export function getDatabase(dbPath?: string): SaveDatabase {
  if (!dbInstance) {
    dbInstance = new SaveDatabase(dbPath);
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
