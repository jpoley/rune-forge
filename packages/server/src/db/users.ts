/**
 * User Database Operations
 *
 * Handles user CRUD operations. Users are synced from Pocket ID on login.
 */

import type { Database } from "bun:sqlite";

/**
 * User record from database.
 */
export interface DbUser {
  id: string;
  display_name: string;
  email: string | null;
  created_at: number;
  last_login_at: number | null;
}

/**
 * Input for creating/updating a user.
 */
export interface UserInput {
  id: string;
  displayName: string;
  email?: string | null;
}

/**
 * User database operations.
 */
export class UserRepository {
  constructor(private db: Database) {}

  /**
   * Find a user by ID.
   */
  findById(id: string): DbUser | null {
    return this.db
      .query<DbUser, [string]>("SELECT * FROM users WHERE id = ?")
      .get(id);
  }

  /**
   * Find a user by email.
   */
  findByEmail(email: string): DbUser | null {
    return this.db
      .query<DbUser, [string]>("SELECT * FROM users WHERE email = ?")
      .get(email);
  }

  /**
   * Create or update a user (upsert on login).
   * Updates display_name, email, and last_login_at on conflict.
   */
  upsert(input: UserInput): DbUser {
    const now = Math.floor(Date.now() / 1000);

    this.db.run(
      `INSERT INTO users (id, display_name, email, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         email = excluded.email,
         last_login_at = excluded.last_login_at`,
      [input.id, input.displayName, input.email ?? null, now, now]
    );

    return this.findById(input.id)!;
  }

  /**
   * Update last login timestamp.
   */
  updateLastLogin(id: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run("UPDATE users SET last_login_at = ? WHERE id = ?", [now, id]);
  }

  /**
   * Get all users (for admin purposes).
   */
  findAll(limit = 100, offset = 0): DbUser[] {
    return this.db
      .query<DbUser, [number, number]>(
        "SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset);
  }

  /**
   * Count total users.
   */
  count(): number {
    const result = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM users")
      .get();
    return result?.count ?? 0;
  }

  /**
   * Delete a user and cascade to related data.
   */
  delete(id: string): boolean {
    const result = this.db.run("DELETE FROM users WHERE id = ?", [id]);
    return result.changes > 0;
  }
}
