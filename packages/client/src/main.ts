/**
 * Main entry point for Rune Forge client.
 *
 * Supports both single-player (offline) and multiplayer modes.
 * Users choose mode from the start screen, or mode can be forced via URL.
 */

import { GameController } from "./game.js";
import { MultiplayerController } from "./multiplayer.js";
import { ScreenManager, type ScreenManagerCallbacks } from "./screens.js";

// =============================================================================
// Mode Detection
// =============================================================================

type GameMode = "singleplayer" | "multiplayer" | "choose";

function detectGameMode(): GameMode {
  const params = new URLSearchParams(window.location.search);
  const modeParam = params.get("mode");

  // Force single player
  if (modeParam === "single" || modeParam === "offline") {
    return "singleplayer";
  }

  // Force multiplayer
  if (modeParam === "multi" || modeParam === "online") {
    return "multiplayer";
  }

  // Coming from auth callback - go to multiplayer
  if (window.location.search.includes("code=")) {
    return "multiplayer";
  }

  // Default: let user choose
  return "choose";
}

// =============================================================================
// Single Player Mode
// =============================================================================

function initSinglePlayer(container: HTMLElement): GameController {
  console.log("[main] Starting single-player mode");

  // Hide mode selection, show single player menu
  const modeSelection = document.getElementById("mode-selection");
  const singlePlayerMenu = document.getElementById("single-player-menu");
  if (modeSelection) modeSelection.style.display = "none";
  if (singlePlayerMenu) singlePlayerMenu.style.display = "flex";

  const game = new GameController(container);

  // Expose to window for debugging
  if (import.meta.env.DEV) {
    (window as unknown as { game: GameController }).game = game;
  }

  return game;
}

// =============================================================================
// Multiplayer Mode
// =============================================================================

interface MultiplayerApp {
  controller: MultiplayerController;
  screenManager: ScreenManager;
}

async function initMultiplayer(container: HTMLElement): Promise<MultiplayerApp> {
  console.log("[main] Starting multiplayer mode");

  // Hide the start screen entirely for multiplayer
  const startScreen = document.getElementById("start-screen");
  if (startScreen) {
    startScreen.style.display = "none";
  }

  // Create multiplayer controller
  const controller = new MultiplayerController(container);

  // Create screen manager with callbacks
  const callbacks: ScreenManagerCallbacks = {
    onLogin: () => {
      controller.login();
    },
    onDevLogin: (name) => {
      controller.devLogin(name);
    },
    onLogout: () => {
      controller.logout();
    },
    onCreateGame: (characterId, config) => {
      controller.createGame(characterId, config).catch(console.error);
    },
    onJoinGame: (joinCode, characterId) => {
      controller.joinGame(joinCode, characterId).catch(console.error);
    },
    onLeaveGame: () => {
      controller.leaveGame();
    },
    onSetReady: (ready) => {
      controller.setReady(ready);
    },
    onStartGame: (monsterTypes) => {
      controller.startGame(monsterTypes).catch(console.error);
    },
    onNavigateToPartySetup: () => {
      controller.navigateToScreen("party_setup");
    },
    onBackToMainMenu: () => {
      controller.navigateToScreen("main_menu");
    },
    onFetchCharacters: async () => {
      const result = await controller.listCharacters();
      return result.characters;
    },
    onCreateCharacter: async (name, characterClass) => {
      return controller.createCharacter(name, characterClass);
    },
  };

  const screenManager = new ScreenManager(callbacks);

  // Connect state changes to screen manager
  controller.onStateChange((state) => {
    screenManager.update(state);
  });

  // Initialize the controller (checks auth, connects WebSocket)
  await controller.initialize();

  // Expose to window for debugging
  if (import.meta.env.DEV) {
    (window as unknown as {
      mp: MultiplayerController;
      screens: ScreenManager;
    }).mp = controller;
    (window as unknown as {
      mp: MultiplayerController;
      screens: ScreenManager;
    }).screens = screenManager;
  }

  return { controller, screenManager };
}

// =============================================================================
// Mode Selection UI
// =============================================================================

function setupModeSelection(container: HTMLElement): void {
  // Single Player button
  document.getElementById("btn-single-player")?.addEventListener("click", () => {
    initSinglePlayer(container);
    console.log("🎮 Rune Forge single-player initialized");
  });

  // Multiplayer button
  document.getElementById("btn-multiplayer")?.addEventListener("click", async () => {
    try {
      await initMultiplayer(container);
      console.log("🎮 Rune Forge multiplayer initialized");
    } catch (error) {
      console.error("Failed to initialize multiplayer:", error);
      alert("Failed to connect to multiplayer server. Please try again.");
    }
  });

  // Back button (from single player menu to mode selection)
  document.getElementById("btn-back-to-mode")?.addEventListener("click", () => {
    const modeSelection = document.getElementById("mode-selection");
    const singlePlayerMenu = document.getElementById("single-player-menu");
    if (modeSelection) modeSelection.style.display = "flex";
    if (singlePlayerMenu) singlePlayerMenu.style.display = "none";
  });
}

// =============================================================================
// Entry Point
// =============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("canvas-container");

  if (!container) {
    console.error("Canvas container not found!");
    return;
  }

  const mode = detectGameMode();

  if (mode === "multiplayer") {
    // Direct to multiplayer (from URL or auth callback)
    try {
      await initMultiplayer(container);
      console.log("🎮 Rune Forge multiplayer initialized");
    } catch (error) {
      console.error("Failed to initialize multiplayer:", error);
      // Show mode selection as fallback
      setupModeSelection(container);
    }
  } else if (mode === "singleplayer") {
    // Direct to single player (from URL)
    initSinglePlayer(container);
    console.log("🎮 Rune Forge single-player initialized");
  } else {
    // Show mode selection
    setupModeSelection(container);
    console.log("🎮 Rune Forge ready - choose your mode");
  }
});
