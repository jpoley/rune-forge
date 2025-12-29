/**
 * API client for save/load operations.
 */

import type { GameState, SaveData, SaveMetadata } from "@rune-forge/simulation";

const API_BASE = "/api";

export class SaveAPI {
  /**
   * List all save slots.
   */
  async listSaves(): Promise<(SaveMetadata | null)[]> {
    const response = await fetch(`${API_BASE}/saves`);

    if (!response.ok) {
      throw new Error(`Failed to list saves: ${response.statusText}`);
    }

    const data = await response.json() as { saves: (SaveMetadata | null)[] };
    return data.saves;
  }

  /**
   * Load a save from a specific slot.
   */
  async loadGame(slot: number): Promise<SaveData | null> {
    const response = await fetch(`${API_BASE}/saves/${slot}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to load save: ${response.statusText}`);
    }

    const data = await response.json() as { save: SaveData };
    return data.save;
  }

  /**
   * Save the game to a specific slot.
   */
  async saveGame(slot: number, name: string, gameState: GameState): Promise<SaveMetadata> {
    const response = await fetch(`${API_BASE}/saves/${slot}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, gameState }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save game: ${response.statusText}`);
    }

    const data = await response.json() as { save: SaveMetadata };
    return data.save;
  }

  /**
   * Delete a save from a specific slot.
   */
  async deleteSave(slot: number): Promise<boolean> {
    const response = await fetch(`${API_BASE}/saves/${slot}`, {
      method: "DELETE",
    });

    if (response.status === 404) {
      return false;
    }

    if (!response.ok) {
      throw new Error(`Failed to delete save: ${response.statusText}`);
    }

    return true;
  }

  /**
   * Health check.
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
