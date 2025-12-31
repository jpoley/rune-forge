/**
 * Character Database Operations
 *
 * Handles character CRUD operations with persona/progression split.
 * - Persona: client-owned, synced from client
 * - Progression: server-owned, never modified by client
 */

import type { Database } from "bun:sqlite";

/**
 * Character class types.
 */
export type CharacterClass = "warrior" | "ranger" | "mage" | "rogue";

/**
 * Character appearance (client-defined).
 */
export interface CharacterAppearance {
  bodyType: "small" | "medium" | "large";
  skinTone: string;
  hairColor: string;
  hairStyle: "bald" | "short" | "medium" | "long" | "ponytail";
  facialHair?: "none" | "stubble" | "beard" | "mustache";
}

/**
 * Character inventory (server-managed).
 */
export interface CharacterInventory {
  weapons: Array<{
    id: string;
    name: string;
    damage: number;
    range: number;
  }>;
  equippedWeaponId: string | null;
}

/**
 * Character record from database.
 */
export interface DbCharacter {
  id: string;
  user_id: string;
  name: string;
  class: CharacterClass;
  appearance: string; // JSON
  backstory: string | null;
  xp: number;
  level: number;
  gold: number;
  silver: number;
  inventory: string; // JSON
  games_played: number;
  monsters_killed: number;
  damage_dealt: number;
  damage_taken: number;
  deaths: number;
  created_at: number;
  updated_at: number;
}

/**
 * Parsed character with typed fields.
 */
export interface Character {
  id: string;
  userId: string;
  name: string;
  class: CharacterClass;
  appearance: CharacterAppearance;
  backstory: string | null;
  xp: number;
  level: number;
  gold: number;
  silver: number;
  inventory: CharacterInventory;
  gamesPlayed: number;
  monstersKilled: number;
  damageDealt: number;
  damageTaken: number;
  deaths: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Character persona input (from client).
 */
export interface CharacterPersonaInput {
  id: string;
  name: string;
  class: CharacterClass;
  appearance: CharacterAppearance;
  backstory?: string | null;
}

/**
 * Character summary for listings.
 */
export interface CharacterSummary {
  id: string;
  name: string;
  class: CharacterClass;
  level: number;
}

/**
 * Convert database record to typed character.
 */
function toCharacter(row: DbCharacter): Character {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    class: row.class,
    appearance: JSON.parse(row.appearance) as CharacterAppearance,
    backstory: row.backstory,
    xp: row.xp,
    level: row.level,
    gold: row.gold,
    silver: row.silver,
    inventory: JSON.parse(row.inventory) as CharacterInventory,
    gamesPlayed: row.games_played,
    monstersKilled: row.monsters_killed,
    damageDealt: row.damage_dealt,
    damageTaken: row.damage_taken,
    deaths: row.deaths,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Character database operations.
 */
export class CharacterRepository {
  constructor(private db: Database) {}

  /**
   * Find a character by ID.
   */
  findById(id: string): Character | null {
    const row = this.db
      .query<DbCharacter, [string]>("SELECT * FROM characters WHERE id = ?")
      .get(id);

    return row ? toCharacter(row) : null;
  }

  /**
   * Find all characters for a user.
   */
  findByUserId(userId: string): Character[] {
    const rows = this.db
      .query<DbCharacter, [string]>(
        "SELECT * FROM characters WHERE user_id = ? ORDER BY updated_at DESC"
      )
      .all(userId);

    return rows.map(toCharacter);
  }

  /**
   * Get character summaries for a user (for listings).
   */
  getSummariesByUserId(userId: string): CharacterSummary[] {
    return this.db
      .query<CharacterSummary, [string]>(
        "SELECT id, name, class, level FROM characters WHERE user_id = ? ORDER BY updated_at DESC"
      )
      .all(userId);
  }

  /**
   * Create a new character from client persona.
   * Server initializes progression fields.
   */
  create(userId: string, persona: CharacterPersonaInput): Character {
    const now = Math.floor(Date.now() / 1000);
    const defaultInventory: CharacterInventory = {
      weapons: [],
      equippedWeaponId: null,
    };

    this.db.run(
      `INSERT INTO characters (
        id, user_id, name, class, appearance, backstory,
        xp, gold, silver, inventory,
        games_played, monsters_killed, damage_dealt, damage_taken, deaths,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 0, 0, 0, ?, ?)`,
      [
        persona.id,
        userId,
        persona.name,
        persona.class,
        JSON.stringify(persona.appearance),
        persona.backstory ?? null,
        JSON.stringify(defaultInventory),
        now,
        now,
      ]
    );

    return this.findById(persona.id)!;
  }

  /**
   * Update character persona (client-owned fields only).
   * Does NOT update progression fields.
   */
  updatePersona(
    id: string,
    userId: string,
    persona: Partial<CharacterPersonaInput>
  ): Character | null {
    const now = Math.floor(Date.now() / 1000);

    // Build update query dynamically
    const updates: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];

    if (persona.name !== undefined) {
      updates.push("name = ?");
      values.push(persona.name);
    }
    if (persona.class !== undefined) {
      updates.push("class = ?");
      values.push(persona.class);
    }
    if (persona.appearance !== undefined) {
      updates.push("appearance = ?");
      values.push(JSON.stringify(persona.appearance));
    }
    if (persona.backstory !== undefined) {
      updates.push("backstory = ?");
      values.push(persona.backstory);
    }

    values.push(id, userId);

    this.db.run(
      `UPDATE characters SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      values as (string | number | null | boolean)[]
    );

    return this.findById(id);
  }

  /**
   * Add XP to a character (server operation).
   */
  addXp(id: string, amount: number): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      "UPDATE characters SET xp = xp + ?, updated_at = ? WHERE id = ?",
      [amount, now, id]
    );
  }

  /**
   * Add gold to a character (server operation).
   */
  addGold(id: string, gold: number, silver = 0): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      "UPDATE characters SET gold = gold + ?, silver = silver + ?, updated_at = ? WHERE id = ?",
      [gold, silver, now, id]
    );
  }

  /**
   * Update inventory (server operation).
   */
  updateInventory(id: string, inventory: CharacterInventory): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      "UPDATE characters SET inventory = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(inventory), now, id]
    );
  }

  /**
   * Update XP and level (for DM commands).
   */
  updateProgression(id: string, data: { xp: number; level: number }): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      "UPDATE characters SET xp = ?, level = ?, updated_at = ? WHERE id = ?",
      [data.xp, data.level, now, id]
    );
  }

  /**
   * Record game statistics after a match.
   */
  recordGameStats(
    id: string,
    stats: {
      monstersKilled?: number;
      damageDealt?: number;
      damageTaken?: number;
      died?: boolean;
    }
  ): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      `UPDATE characters SET
        games_played = games_played + 1,
        monsters_killed = monsters_killed + ?,
        damage_dealt = damage_dealt + ?,
        damage_taken = damage_taken + ?,
        deaths = deaths + ?,
        updated_at = ?
       WHERE id = ?`,
      [
        stats.monstersKilled ?? 0,
        stats.damageDealt ?? 0,
        stats.damageTaken ?? 0,
        stats.died ? 1 : 0,
        now,
        id,
      ]
    );
  }

  /**
   * Delete a character.
   */
  delete(id: string, userId: string): boolean {
    const result = this.db.run(
      "DELETE FROM characters WHERE id = ? AND user_id = ?",
      [id, userId]
    );
    return result.changes > 0;
  }

  /**
   * Check if character belongs to user.
   */
  belongsToUser(characterId: string, userId: string): boolean {
    const result = this.db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) as count FROM characters WHERE id = ? AND user_id = ?"
      )
      .get(characterId, userId);

    return (result?.count ?? 0) > 0;
  }
}
