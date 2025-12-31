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
import { initializeGame, executeGameAction } from "./executor.js";
import { findPath } from "@rune-forge/simulation";
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
import type { CharacterPersonaInput } from "../db/characters.js";

/**
 * Register all game message handlers.
 */
export function registerGameHandlers(): void {
  // =========================================================================
  // Session Management
  // =========================================================================

  /**
   * Create a new game session.
   */
  registerHandler("create_game", async (ws, payload, seq) => {
    console.log(`[game] create_game request from ${ws.data.user?.sub ?? "unknown"} (seq: ${seq})`);
    const user = ws.data.user;
    if (!user) {
      sendError(ws, "AUTH_REQUIRED", "Not authenticated", seq);
      return;
    }

    try {
      const data = payload as CreateGamePayload;
      console.log(`[game] Creating session for ${user.sub}, characterId: ${data.characterId}`);

      const session = createSession(user.sub, {
        maxPlayers: data.config?.maxPlayers ?? 8,
        mapSeed: data.config?.mapSeed,
        difficulty: data.config?.difficulty ?? "normal",
        turnTimeLimit: data.config?.turnTimeLimit ?? 0,
        npcCount: data.config?.npcCount ?? 2,
        npcClasses: data.config?.npcClasses,
        monsterCount: data.config?.monsterCount ?? 10,
        playerMoveRange: data.config?.playerMoveRange ?? 3,
      });

      // Join the session with character
      if (data.characterId) {
        joinSession(session.id, user.sub, data.characterId);
        console.log(`[game] Player ${user.sub} joined session ${session.id}`);
      } else {
        console.log(`[game] Warning: No characterId provided for session ${session.id}`);
      }

      // Set connection's session
      ws.data.sessionId = session.id;

      console.log(`[game] Sending game_created response (seq: ${seq})`);
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
      console.error(`[game] create_game error:`, error);
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
    let action = data.action;

    // For move actions, calculate the full path from player's current position
    if (action.type === "move" && action.path && action.path.length === 1) {
      const session = getSession(sessionId);
      if (session?.gameState) {
        const db = getDb();
        const player = db.sessions.getPlayer(sessionId, user.sub);
        if (player?.unitId) {
          const unit = session.gameState.units.find(u => u.id === player.unitId);
          if (unit) {
            const destination = action.path[0]!;
            const fullPath = findPath(
              unit.position,
              destination,
              session.gameState.map,
              session.gameState.units,
              unit.id
            );
            if (fullPath) {
              action = { ...action, path: fullPath };
            } else {
              sendMessage(ws, "action_result", {
                valid: false,
                reason: "No valid path to destination",
              }, seq);
              return;
            }
          }
        }
      }
    }

    // For collect_loot actions, transform lootId to lootDropId for simulation
    if (action.type === "collect_loot" && "lootId" in action) {
      const lootAction = action as { type: "collect_loot"; unitId: string; lootId: string };
      action = {
        type: "collect_loot",
        unitId: lootAction.unitId,
        lootDropId: lootAction.lootId,
      };
    }

    const result = executeGameAction(sessionId, user.sub, action);

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
  // Character Sync
  // =========================================================================

  /**
   * Sync a character from client to server.
   * Creates or updates the character persona (client-owned fields).
   */
  registerHandler("sync_character", async (ws, payload, seq) => {
    console.log(`[game] sync_character request from ${ws.data.user?.sub ?? "unknown"} (seq: ${seq})`);
    const user = ws.data.user;
    if (!user) {
      sendError(ws, "AUTH_REQUIRED", "Not authenticated", seq);
      return;
    }

    try {
      const data = payload as { character: CharacterPersonaInput };
      console.log(`[game] Syncing character: ${data.character?.name} (${data.character?.id})`);
      const db = getDb();

      // Validate the character data
      if (!data.character || !data.character.id || !data.character.name || !data.character.class) {
        sendError(ws, "INVALID_CHARACTER", "Invalid character data", seq);
        return;
      }

      // Validate name length
      const name = data.character.name.trim();
      if (name.length < 3 || name.length > 30) {
        sendError(ws, "INVALID_NAME", "Name must be 3-30 characters", seq);
        return;
      }

      // Check if character exists
      const existing = db.characters.findById(data.character.id);

      let character;
      if (existing) {
        // Verify ownership
        if (existing.userId !== user.sub) {
          sendError(ws, "PERMISSION_DENIED", "Not your character", seq);
          return;
        }
        // Update existing character
        character = db.characters.updatePersona(data.character.id, user.sub, {
          name,
          class: data.character.class,
          appearance: data.character.appearance,
          backstory: data.character.backstory,
        });
      } else {
        // Create new character
        console.log(`[game] Creating new character: ${data.character.id} for user ${user.sub}`);
        character = db.characters.create(user.sub, {
          ...data.character,
          name,
        });
        console.log(`[game] Character created:`, character ? `${character.id} (${character.name})` : "FAILED");
      }

      if (!character) {
        console.error(`[game] Character creation/update returned null`);
        sendError(ws, "SYNC_FAILED", "Failed to sync character", seq);
        return;
      }

      console.log(`[game] Sync successful: ${character.id} belongs to ${user.sub}`);

      // Return the full character (including server-side progression)
      sendMessage(ws, "character_synced", {
        id: character.id,
        name: character.name,
        class: character.class,
        level: character.level,
        xp: character.xp,
        gold: character.gold,
        silver: character.silver,
        gamesPlayed: character.gamesPlayed,
        monstersKilled: character.monstersKilled,
      }, seq);
    } catch (error) {
      console.error("[game] Character sync error:", error);
      const message = error instanceof Error ? error.message : "Sync failed";
      sendError(ws, "SYNC_FAILED", message, seq);
    }
  });

  /**
   * Get all characters for the current user.
   */
  registerHandler("get_characters", async (ws, payload, seq) => {
    const user = ws.data.user;
    if (!user) {
      sendError(ws, "AUTH_REQUIRED", "Not authenticated", seq);
      return;
    }

    try {
      const db = getDb();
      const characters = db.characters.findByUserId(user.sub);

      sendMessage(ws, "characters_list", {
        characters: characters.map(c => ({
          id: c.id,
          name: c.name,
          class: c.class,
          level: c.level,
          xp: c.xp,
          gold: c.gold,
          silver: c.silver,
        })),
      }, seq);
    } catch (error) {
      console.error("[game] Get characters error:", error);
      sendError(ws, "FETCH_FAILED", "Failed to fetch characters", seq);
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
          initializeGame(sessionId);

          // Send full state to all players
          const gameSession = getSession(sessionId);
          if (gameSession?.gameState) {
            const players = getDb().sessions.getPlayers(sessionId);
            console.log(`[game] Sending full_state to ${players.length} players`);
            for (const player of players) {
              console.log(`[game] Player ${player.userId} has unitId: ${player.unitId}`);
              const playerWs = require("../ws/index.js").getConnectionByUserId(player.userId);
              if (playerWs) {
                // Find the player's unit to log position
                const myUnit = gameSession.gameState.units.find(u => u.id === player.unitId);
                console.log(`[game] Player unit position: ${JSON.stringify(myUnit?.position)}`);
                sendMessage(playerWs, "full_state", {
                  version: gameSession.stateVersion,
                  gameState: gameSession.gameState,
                  yourUnitId: player.unitId,
                });
              }
            }

            // Broadcast initial turn change so clients know whose turn it is
            const currentUnitId = gameSession.gameState.combat.turnState?.unitId;
            if (currentUnitId) {
              // Get the current unit to check its type
              const currentUnit = gameSession.gameState.units.find(u => u.id === currentUnitId);
              const currentPlayer = currentUnit?.type === "player"
                ? players.find((p) => p.unitId === currentUnitId)
                : null;

              broadcastToSession(sessionId, "turn_change", {
                currentUnitId,
                currentUserId: currentPlayer?.userId ?? null,
                turnNumber: gameSession.gameState.combat.turnNumber,
                isPlayerTurn: currentUnit?.type === "player",
              });

              // Trigger AI for non-player units
              if (currentUnit?.type === "npc") {
                const { executeNpcTurn } = require("./executor.js");
                executeNpcTurn(gameSession);
              } else if (currentUnit?.type === "monster") {
                const { executeMonsterTurn } = require("./executor.js");
                executeMonsterTurn(gameSession);
              }
              // If it's a player's turn, do nothing - wait for player input
            }
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
            // DM can force end any unit's turn
            const currentUnitId = session.gameState.combat.turnState?.unitId;
            if (!currentUnitId) {
              sendError(ws, "NO_ACTIVE_TURN", "No active turn to skip", seq);
              return;
            }
            // Execute end_turn directly on the simulation, bypassing player check
            const { executeAction } = require("@rune-forge/simulation");
            const { createDelta } = require("./state.js");
            const { handleTurnChange } = require("./executor.js");
            try {
              const oldState = session.gameState;
              const oldVersion = session.stateVersion;
              const result = executeAction({ type: "end_turn", unitId: currentUnitId }, session.gameState);
              session.gameState = result.state;
              session.stateVersion += 1;
              const delta = createDelta(oldState, result.state, oldVersion, session.stateVersion);
              getDb().sessions.updateGameState(sessionId, result.state, session.stateVersion);
              getDb().sessions.appendEvents(sessionId, result.events);
              broadcastToSession(sessionId, "events", { events: result.events });
              broadcastToSession(sessionId, "state_delta", { delta });
              broadcastToSession(sessionId, "dm_skip_turn", { skippedUnitId: currentUnitId });
              // Trigger next turn
              if (result.events.some((e: { type: string }) => e.type === "turn_ended" || e.type === "turn_started")) {
                handleTurnChange(session);
              }
            } catch (error) {
              console.error("[game] DM skip turn error:", error);
              sendError(ws, "SKIP_FAILED", "Failed to skip turn", seq);
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
