/**
 * Main entry point for Rune Forge client.
 *
 * Supports both single-player (offline) and multiplayer modes.
 * Mode is determined by URL parameter or auth availability.
 */

import { GameController } from "./game.js";
import { MultiplayerController } from "./multiplayer.js";
import { ScreenManager, type ScreenManagerCallbacks } from "./screens.js";

// =============================================================================
// Mode Detection
// =============================================================================

type GameMode = "singleplayer" | "multiplayer";

function detectGameMode(): GameMode {
  // Check URL parameter first
  const params = new URLSearchParams(window.location.search);
  const modeParam = params.get("mode");

  if (modeParam === "single" || modeParam === "offline") {
    return "singleplayer";
  }

  if (modeParam === "multi" || modeParam === "online") {
    return "multiplayer";
  }

  // Default: check if we're coming from an auth callback
  if (window.location.search.includes("code=")) {
    return "multiplayer";
  }

  // Default to single-player for now
  // In production, you might default to multiplayer
  return "singleplayer";
}

// =============================================================================
// Single Player Mode
// =============================================================================

function initSinglePlayer(container: HTMLElement): GameController {
  console.log("[main] Starting single-player mode");

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

  // Hide single-player start screen
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
    onLoginWithName: (name) => {
      controller.loginWithName(name);
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
    onStartGame: () => {
      controller.startGame().catch(console.error);
    },
    onNavigateToPartySetup: () => {
      controller.navigateToPartySetup();
    },
    onBackToMainMenu: () => {
      controller.backToMainMenu();
    },
    isAuthEnabled: () => {
      return controller.isAuthEnabled();
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
    try {
      await initMultiplayer(container);
      console.log("🎮 Rune Forge multiplayer initialized");
    } catch (error) {
      console.error("Failed to initialize multiplayer:", error);
      // Fallback to single-player
      console.log("Falling back to single-player mode");
      initSinglePlayer(container);
    }
  } else {
    initSinglePlayer(container);
    console.log("🎮 Rune Forge single-player initialized");
  }
});
