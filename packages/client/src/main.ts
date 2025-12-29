/**
 * Main entry point for Rune Forge client.
 */

import { GameController } from "./game.js";

// Wait for DOM to be ready
document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("canvas-container");

  if (!container) {
    console.error("Canvas container not found!");
    return;
  }

  // Initialize the game controller
  const game = new GameController(container);

  // Expose to window for debugging
  if (import.meta.env.DEV) {
    (window as unknown as { game: GameController }).game = game;
  }

  console.log("🎮 Rune Forge initialized");
});
