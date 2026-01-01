/**
 * WebSocket Message Handlers
 *
 * Registers handlers for all game-related WebSocket messages.
 */

import { getDb } from "../db/index.js";
import {
  registerHandler,
  sendMessage,
  sendError,
  broadcastToSession,
  type TypedWebSocket,
} from "../ws/index.js";
import {
  createSession,
  joinSession,
  leaveSession,
  setPlayerReady,
  startGame,
  pauseGame,
  resumeGame,
  endSession,
  kickPlayer,
  getLobbyState,
  getSession,
  getSessionByJoinCode,
} from "./session.js";
import { initializeGame, executeGameAction, handleTurnChange } from "./executor.js";
import {
  grantGold,
  grantXp,
  grantWeapon,
  spawnMonster,
  removeMonster,
  modifyMonster,
} from "./dm-commands.js";
import type {
  CreateGamePayload,
  JoinGamePayload,
  ReadyPayload,
  ActionPayload,
  ChatPayload,
  DMCommand,
} from "@rune-forge/shared";

/**
 * Register all game message handlers.
 */
export function registerGameHandlers(): void {
  // =========================================================================
  // Character Management
  // =========================================================================

  /**
   * List user's characters.
   */
  registerHandler("list_characters", async (ws, payload, seq) => {
    const user = ws.data.user;
    if (!user) {
      sendError(ws, "AUTH_REQUIRED", "Not authenticated", seq);
      return;
    }

    const db = getDb();
    const characters = db.characters.getSummariesByUserId(user.sub);

    sendMessage(ws, "characters_list", { characters }, seq);
  });

  /**
   * Create a new character (server-generated ID).
   */
  registerHandler("create_character", async (ws, payload, seq) => {
    const user = ws.data.user;
    if (!user) {
      sendError(ws, "AUTH_REQUIRED", "Not authenticated", seq);
      return;
    }

    const data = payload as {
      name: string;
      class: "warrior" | "ranger" | "mage" | "rogue";
    };

    console.log("[game] create_character request:", {
      userId: user.sub,
      name: data.name,
      class: data.class,
    });

    if (!data.name || !data.class) {
      sendError(ws, "INVALID_PAYLOAD", "Name and class are required", seq);
      return;
    }

    const db = getDb();
    const { randomUUID } = await import("crypto");

    try {
      const charId = `char-${randomUUID()}`;
      console.log("[game] create_character generating ID:", charId);

      const character = db.characters.create(user.sub, {
        id: charId,
        name: data.name,
        class: data.class,
        appearance: {
          bodyType: "medium",
          skinTone: "#c9a882",
          hairColor: "#4a3728",
          hairStyle: "short",
        },
      });

      console.log("[game] create_character success:", {
        id: character.id,
        name: character.name,
      });

      sendMessage(ws, "character_created", {
        id: character.id,
        name: character.name,
        class: character.class,
        level: character.level,
      }, seq);
    } catch (error) {
      console.error("[game] create_character error:", error);
      const message = error instanceof Error ? error.message : "Failed to create character";
      sendError(ws, "CREATE_FAILED", message, seq);
    }
  });

  /**
   * Sync a character from client (upsert with client-provided ID).
   * Creates the character if it doesn't exist, updates persona if it does.
   */
  registerHandler("sync_character", async (ws, payload, seq) => {
    const user = ws.data.user;
    if (!user) {
      sendError(ws, "AUTH_REQUIRED", "Not authenticated", seq);
      return;
    }

    const data = payload as {
      id: string;
      name: string;
      class: "warrior" | "ranger" | "mage" | "rogue";
      appearance: {
        bodyType: "small" | "medium" | "large";
        skinTone: string;
        hairColor: string;
        hairStyle: "bald" | "short" | "medium" | "long" | "ponytail";
        facialHair?: "none" | "stubble" | "beard" | "mustache";
      };
      backstory?: string | null;
    };

    console.log("[game] sync_character request:", {
      userId: user.sub,
      characterId: data.id,
      name: data.name,
      class: data.class,
    });

    if (!data.id || !data.name || !data.class || !data.appearance) {
      console.log("[game] sync_character invalid payload:", data);
      sendError(ws, "INVALID_PAYLOAD", "id, name, class, and appearance are required", seq);
      return;
    }

    const db = getDb();

    try {
      // Check if character already exists
      const existing = db.characters.findById(data.id);
      console.log("[game] sync_character existing check:", existing ? `Found (owner: ${existing.userId})` : "Not found");

      let character;
      if (existing) {
        // Verify ownership
        if (existing.userId !== user.sub) {
          console.log("[game] sync_character ownership mismatch:", {
            existingOwner: existing.userId,
            requestingUser: user.sub,
          });
          sendError(ws, "FORBIDDEN", "Character belongs to another user", seq);
          return;
        }
        // Update persona only
        console.log("[game] sync_character updating existing character");
        character = db.characters.updatePersona(data.id, user.sub, {
          name: data.name,
          class: data.class,
          appearance: data.appearance,
          backstory: data.backstory,
        });
      } else {
        // Create new character with client-provided ID
        console.log("[game] sync_character creating new character with ID:", data.id);
        character = db.characters.create(user.sub, {
          id: data.id,
          name: data.name,
          class: data.class,
          appearance: data.appearance,
          backstory: data.backstory,
        });
      }

      if (!character) {
        console.error("[game] sync_character failed to create/update");
        sendError(ws, "SYNC_FAILED", "Failed to sync character", seq);
        return;
      }

      console.log("[game] sync_character success:", {
        id: character.id,
        name: character.name,
        level: character.level,
      });

      sendMessage(ws, "character_synced", {
        id: character.id,
        name: character.name,
        class: character.class,
        level: character.level,
        xp: character.xp,
        gold: character.gold,
        silver: character.silver,
      }, seq);
    } catch (error) {
      console.error("[game] sync_character error:", error);
      const message = error instanceof Error ? error.message : "Failed to sync character";
      sendError(ws, "SYNC_FAILED", message, seq);
    }
  });

  // =========================================================================
  // Session Management
  // =========================================================================

  /**
   * Create a new game session.
   */
  registerHandler("create_game", async (ws, payload, seq) => {
    const user = ws.data.user;
    if (!user) {
      sendError(ws, "AUTH_REQUIRED", "Not authenticated", seq);
      return;
    }

    try {
      const data = payload as CreateGamePayload;
      console.log("[game] create_game request:", {
        userId: user.sub,
        characterId: data.characterId,
        config: data.config,
      });

      const config: Parameters<typeof createSession>[1] = {
        maxPlayers: data.config?.maxPlayers ?? 4,
        difficulty: data.config?.difficulty ?? "normal",
        turnTimeLimit: data.config?.turnTimeLimit ?? 0,
        // DM Options - wire through monsterCount and playerMoveRange
        monsterCount: data.config?.monsterCount ?? 3,
        playerMoveRange: data.config?.playerMoveRange ?? 3,
        // NPC party members
        npcCount: data.config?.npcCount ?? 0,
        npcClasses: data.config?.npcClasses ?? [],
      };
      if (data.config?.mapSeed !== undefined) {
        config.mapSeed = data.config.mapSeed;
      }
      console.log("[game] Session config with DM options:", config);

      // Check if character exists before creating session
      if (data.characterId) {
        const db = getDb();
        const charExists = db.characters.belongsToUser(data.characterId, user.sub);
        console.log("[game] Character check:", {
          characterId: data.characterId,
          userId: user.sub,
          exists: charExists,
        });

        if (!charExists) {
          // List all characters for this user for debugging
          const userChars = db.characters.getSummariesByUserId(user.sub);
          console.log("[game] User's characters in DB:", userChars);
          sendError(ws, "CHARACTER_NOT_FOUND", `Character ${data.characterId} not found for user ${user.sub}`, seq);
          return;
        }
      }

      const session = createSession(user.sub, config);
      console.log("[game] Session created:", session.id);

      // Join the session with character
      if (data.characterId) {
        joinSession(session.id, user.sub, data.characterId);
        console.log("[game] Player joined session with character");
      }

      // Set connection's session
      ws.data.sessionId = session.id;

      sendMessage(ws, "game_created", {
        sessionId: session.id,
        joinCode: session.joinCode,
      }, seq);

      // Send lobby state
      const lobbyState = getLobbyState(session.id);
      if (lobbyState) {
        sendMessage(ws, "lobby_state", lobbyState);
      }
    } catch (error) {
      console.error("[game] create_game error:", error);
      const message = error instanceof Error ? error.message : "Failed to create game";
      sendError(ws, message, message, seq);
    }
  });

  /**
   * Join an existing game.
   */
  registerHandler("join_game", async (ws, payload, seq) => {
    const user = ws.data.user;
    if (!user) {
      sendError(ws, "AUTH_REQUIRED", "Not authenticated", seq);
      return;
    }

    try {
      const data = payload as JoinGamePayload;

      // Find session by join code
      const session = getSessionByJoinCode(data.joinCode);
      if (!session) {
        sendError(ws, "SESSION_NOT_FOUND", "Game not found", seq);
        return;
      }

      // Join the session
      joinSession(session.id, user.sub, data.characterId);

      // Set connection's session
      ws.data.sessionId = session.id;

      // Get user info for broadcast
      const dbUser = getDb().users.findById(user.sub);
      const character = getDb().characters.findById(data.characterId);

      // Notify other players
      broadcastToSession(session.id, "player_joined", {
        userId: user.sub,
        name: dbUser?.display_name ?? user.name,
        characterName: character?.name ?? "Unknown",
        characterClass: character?.class ?? "warrior",
      }, ws.data.id);

      sendMessage(ws, "game_joined", {
        sessionId: session.id,
      }, seq);

      // Send lobby state
      const lobbyState = getLobbyState(session.id);
      if (lobbyState) {
        sendMessage(ws, "lobby_state", lobbyState);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to join game";
      sendError(ws, message, message, seq);
    }
  });

  /**
   * Leave the current game.
   */
  registerHandler("leave_game", async (ws, payload, seq) => {
    const user = ws.data.user;
    const sessionId = ws.data.sessionId;

    if (!user || !sessionId) {
      sendError(ws, "NOT_IN_SESSION", "Not in a game", seq);
      return;
    }

    leaveSession(sessionId, user.sub);
    ws.data.sessionId = null;

    sendMessage(ws, "left_game", {}, seq);
  });

  /**
   * Set ready status in lobby.
   */
  registerHandler("ready", async (ws, payload, seq) => {
    const user = ws.data.user;
    const sessionId = ws.data.sessionId;

    if (!user || !sessionId) {
      sendError(ws, "NOT_IN_SESSION", "Not in a game", seq);
      return;
    }

    const data = payload as ReadyPayload;
    setPlayerReady(sessionId, user.sub, data.ready);

    sendMessage(ws, "ready_confirmed", { ready: data.ready }, seq);
  });

  // =========================================================================
  // Game Actions
  // =========================================================================

  /**
   * Execute a game action.
   */
  registerHandler("action", async (ws, payload, seq) => {
    const user = ws.data.user;
    const sessionId = ws.data.sessionId;

    if (!user || !sessionId) {
      sendError(ws, "NOT_IN_SESSION", "Not in a game", seq);
      return;
    }

    const data = payload as ActionPayload;
    const result = executeGameAction(sessionId, user.sub, data.action);

    if (result.success) {
      sendMessage(ws, "action_result", {
        valid: true,
        events: result.events,
      }, seq);
    } else {
      sendMessage(ws, "action_result", {
        valid: false,
        reason: result.error,
      }, seq);
    }
  });

  /**
   * Request full state sync.
   */
  registerHandler("request_sync", async (ws, payload, seq) => {
    const user = ws.data.user;
    const sessionId = ws.data.sessionId;

    if (!user || !sessionId) {
      sendError(ws, "NOT_IN_SESSION", "Not in a game", seq);
      return;
    }

    const session = getSession(sessionId);
    if (!session || !session.gameState) {
      sendError(ws, "GAME_NOT_STARTED", "Game not started", seq);
      return;
    }

    // Get player's unit ID
    const player = getDb().sessions.getPlayer(sessionId, user.sub);

    sendMessage(ws, "full_state", {
      version: session.stateVersion,
      gameState: session.gameState,
      yourUnitId: player?.unitId,
    }, seq);
  });

  // =========================================================================
  // Chat
  // =========================================================================

  /**
   * Send a chat message.
   */
  registerHandler("chat", async (ws, payload, seq) => {
    const user = ws.data.user;
    const sessionId = ws.data.sessionId;

    if (!user) {
      sendError(ws, "AUTH_REQUIRED", "Not authenticated", seq);
      return;
    }

    const data = payload as ChatPayload;

    // Sanitize message
    const message = data.message.slice(0, 500).trim();
    if (!message) return;

    const chatPayload = {
      from: user.sub,
      fromName: user.name,
      message,
      isWhisper: !!data.target,
      ts: Date.now(),
    };

    if (data.target) {
      // Whisper to specific user
      const targetWs = require("../ws/index.js").getConnectionByUserId(data.target);
      if (targetWs) {
        sendMessage(targetWs, "chat_received", chatPayload);
      }
      // Also send to sender
      sendMessage(ws, "chat_received", chatPayload);
    } else if (sessionId) {
      // Broadcast to session
      broadcastToSession(sessionId, "chat_received", chatPayload);
    }
  });

  // =========================================================================
  // DM Commands
  // =========================================================================

  /**
   * Execute a DM command.
   */
  registerHandler("dm_command", async (ws, payload, seq) => {
    const user = ws.data.user;
    const sessionId = ws.data.sessionId;

    if (!user || !sessionId) {
      sendError(ws, "NOT_IN_SESSION", "Not in a game", seq);
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      sendError(ws, "SESSION_NOT_FOUND", "Session not found", seq);
      return;
    }

    if (session.dmUserId !== user.sub) {
      sendError(ws, "DM_REQUIRED", "Only the DM can use this command", seq);
      return;
    }

    const data = payload as { command: DMCommand };

    try {
      switch (data.command.command) {
        case "start_game":
          startGame(sessionId, user.sub);
          initializeGame(sessionId, data.command.monsterTypes);

          // Send full state to all players
          const gameSession = getSession(sessionId);
          if (gameSession?.gameState) {
            const players = getDb().sessions.getPlayers(sessionId);
            for (const player of players) {
              const playerWs = require("../ws/index.js").getConnectionByUserId(player.userId);
              if (playerWs) {
                sendMessage(playerWs, "full_state", {
                  version: gameSession.stateVersion,
                  gameState: gameSession.gameState,
                  yourUnitId: player.unitId,
                });
              }
            }

            // Trigger the first turn (broadcasts turn_change and runs monster AI if needed)
            handleTurnChange(gameSession);
          }
          break;

        case "pause_game":
          pauseGame(sessionId, user.sub);
          break;

        case "resume_game":
          resumeGame(sessionId, user.sub);
          break;

        case "end_game":
          endSession(sessionId, "dm_ended");
          break;

        case "kick_player":
          kickPlayer(sessionId, user.sub, data.command.targetUserId);
          break;

        case "skip_turn":
          if (session.gameState) {
            const currentUnitId = session.gameState.combat.turnState?.unitId;
            if (!currentUnitId) {
              sendError(ws, "INVALID_STATE", "No current turn to skip", seq);
              return;
            }
            const result = executeGameAction(sessionId, user.sub, { type: "end_turn", unitId: currentUnitId });
            if (!result.success) {
              sendError(ws, "INVALID_ACTION", result.error ?? "Failed to skip turn", seq);
              return;
            }
          }
          break;

        case "grant_gold": {
          const goldResult = grantGold(session, data.command.targetUserId, data.command.amount);
          if (!goldResult.success) {
            sendError(ws, goldResult.error ?? "GRANT_FAILED", goldResult.error ?? "Failed to grant gold", seq);
            return;
          }
          break;
        }

        case "grant_xp": {
          const xpResult = grantXp(session, data.command.targetUserId, data.command.amount);
          if (!xpResult.success) {
            sendError(ws, xpResult.error ?? "GRANT_FAILED", xpResult.error ?? "Failed to grant XP", seq);
            return;
          }
          break;
        }

        case "grant_weapon": {
          const weaponResult = grantWeapon(session, data.command.targetUserId, data.command.weaponId);
          if (!weaponResult.success) {
            sendError(ws, weaponResult.error ?? "GRANT_FAILED", weaponResult.error ?? "Failed to grant weapon", seq);
            return;
          }
          break;
        }

        case "spawn_monster": {
          const spawnResult = spawnMonster(session, data.command.position, data.command.monsterType);
          if (!spawnResult.success) {
            sendError(ws, spawnResult.error ?? "SPAWN_FAILED", spawnResult.error ?? "Failed to spawn monster", seq);
            return;
          }
          break;
        }

        case "remove_monster": {
          const removeResult = removeMonster(session, data.command.unitId);
          if (!removeResult.success) {
            sendError(ws, removeResult.error ?? "REMOVE_FAILED", removeResult.error ?? "Failed to remove monster", seq);
            return;
          }
          break;
        }

        case "modify_monster": {
          const modifyResult = modifyMonster(session, data.command.unitId, data.command.stats);
          if (!modifyResult.success) {
            sendError(ws, modifyResult.error ?? "MODIFY_FAILED", modifyResult.error ?? "Failed to modify monster", seq);
            return;
          }
          break;
        }

        default:
          sendError(ws, "INVALID_COMMAND", "Unknown command", seq);
          return;
      }

      sendMessage(ws, "dm_command_result", { success: true }, seq);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command failed";
      sendError(ws, message, message, seq);
    }
  });

  console.log("[game] Message handlers registered");
}
