/**
 * Multiplayer Controller
 *
 * Manages multiplayer game sessions, connecting the WebSocket client,
 * auth client, and game rendering. Uses server-authoritative state.
 */

import { authClient, type UserInfo } from "./auth.js";
import { wsClient, type ConnectionStatus, type TurnChangeInfo } from "./ws.js";
import { IsometricRenderer } from "./renderer.js";
import { GameUI, type CharacterSelection, type NpcTurnMode } from "./ui.js";
import {
  generateMap,
  getValidMoveTargets,
  getValidAttackTargets,
  findPath,
  type GameState,
  type GameEvent,
  type Position,
  type Unit,
  type GameMap,
} from "@rune-forge/simulation";
import type {
  FullStatePayload,
  DeltaStatePayload,
  EventsPayload,
  ActionResultPayload,
  LobbyStatePayload,
  GameEvent as SharedGameEvent,
} from "@rune-forge/shared";
import {
  getCharacter,
  markSynced,
  type LocalCharacter,
} from "./db/character-db.js";
import { ChatUI } from "./chat.js";
import { DMControls } from "./dm-controls.js";
import { MONSTER_TYPES, CHARACTER_CLASSES, getCharacterClass } from "./characters.js";

// =============================================================================
// Types
// =============================================================================

/** Multiplayer screen state */
export type MultiplayerScreen =
  | "login"
  | "main_menu"
  | "party_setup"
  | "lobby"
  | "game"
  | "loading";

/** Lobby player info */
export interface LobbyPlayer {
  id: string;
  name: string;
  characterName: string;
  ready: boolean;
  isDM: boolean;
  connected: boolean;
}

/** Multiplayer game state */
export interface MultiplayerState {
  screen: MultiplayerScreen;
  user: UserInfo | null;
  connectionStatus: ConnectionStatus;
  sessionId: string | null;
  joinCode: string | null;
  isDM: boolean;
  players: LobbyPlayer[];
  gameState: GameState | null;
  stateVersion: number;
  myUnitId: string | null;
  isMyTurn: boolean;
  turnInfo: TurnChangeInfo | null;
  pendingAction: boolean;
  isPaused: boolean;
}

/** State change callback */
type StateChangeCallback = (state: MultiplayerState) => void;

// =============================================================================
// Multiplayer Controller
// =============================================================================

/** Multiplayer interaction mode */
type MultiplayerMode = "idle" | "move" | "attack";

export class MultiplayerController {
  private renderer: IsometricRenderer;
  private ui: GameUI;
  private chatUI: ChatUI | null = null;
  private dmControls: DMControls | null = null;
  private container: HTMLElement;

  // Interaction mode and valid targets
  private mode: MultiplayerMode = "idle";
  private validMoveTargets: Position[] = [];
  private validAttackTargets: Unit[] = [];

  private state: MultiplayerState = {
    screen: "loading",
    user: null,
    connectionStatus: "disconnected",
    sessionId: null,
    joinCode: null,
    isDM: false,
    players: [],
    gameState: null,
    stateVersion: 0,
    myUnitId: null,
    isMyTurn: false,
    turnInfo: null,
    pendingAction: false,
    isPaused: false,
  };

  private listeners = new Set<StateChangeCallback>();

  // Cleanup functions for subscriptions
  private cleanups: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new IsometricRenderer(container);
    this.ui = new GameUI();

    this.setupRendererHandlers();
    this.setupUIHandlers();
    this.setupWebSocketHandlers();
    this.renderer.startRenderLoop();
  }

  /**
   * Setup UI action button handlers.
   */
  private setupUIHandlers(): void {
    this.ui.onMoveAction = () => {
      console.log("[mp] Move button clicked, isMyTurn:", this.state.isMyTurn);
      if (this.state.isMyTurn) {
        this.setMode("move");
      } else {
        this.ui.addLogEntry("Not your turn!", "system");
      }
    };

    this.ui.onAttackAction = () => {
      console.log("[mp] Attack button clicked, isMyTurn:", this.state.isMyTurn);
      if (this.state.isMyTurn) {
        this.setMode("attack");
      } else {
        this.ui.addLogEntry("Not your turn!", "system");
      }
    };

    this.ui.onEndTurn = () => {
      console.log("[mp] End Turn button clicked, isMyTurn:", this.state.isMyTurn, "pendingAction:", this.state.pendingAction, "myUnitId:", this.state.myUnitId);
      if (!this.state.isMyTurn) {
        this.ui.addLogEntry("Not your turn!", "system");
        return;
      }
      if (this.state.pendingAction) {
        this.ui.addLogEntry("Action in progress...", "system");
        return;
      }
      if (!this.state.myUnitId) {
        this.ui.addLogEntry("No unit assigned!", "system");
        return;
      }
      this.sendAction({
        type: "end_turn",
        unitId: this.state.myUnitId,
      });
    };

    this.ui.onSleep = () => {
      console.log("[mp] Sleep button clicked, isMyTurn:", this.state.isMyTurn);
      // Sleep is not implemented as a server action yet
      // In single-player it heals and ends turn, but multiplayer needs server validation
      this.ui.addLogEntry("Sleep is not available in multiplayer (coming soon)", "system");
    };

    this.ui.onPauseGame = () => {
      console.log("[mp] Pause button clicked, isPaused:", this.state.isPaused, "isDM:", this.state.isDM);
      if (!this.state.isDM) {
        this.ui.addLogEntry("Only the DM can pause the game", "system");
        return;
      }
      if (this.state.isPaused) {
        wsClient.sendDMCommand({ command: "resume_game" });
      } else {
        wsClient.sendDMCommand({ command: "pause_game" });
      }
    };
  }

  /**
   * Initialize the multiplayer system.
   * Checks auth status and connects WebSocket if authenticated.
   */
  async initialize(): Promise<void> {
    this.updateState({ screen: "loading" });

    // Initialize auth
    const authStatus = await authClient.initialize();

    if (authStatus.authenticated && authStatus.user) {
      this.updateState({
        user: authStatus.user,
        screen: "main_menu",
      });

      // Connect WebSocket with session token
      const token = authClient.getSessionToken();
      if (token) {
        wsClient.connect(token);
      }
    } else {
      this.updateState({
        user: null,
        screen: "login",
      });
    }

    // Subscribe to auth changes
    this.cleanups.push(
      authClient.onStatusChange((status) => {
        if (status.authenticated && status.user) {
          this.updateState({ user: status.user });

          // Connect WebSocket if not connected
          if (!wsClient.isConnected()) {
            const token = authClient.getSessionToken();
            if (token) {
              wsClient.connect(token);
            }
          }
        } else {
          this.updateState({
            user: null,
            screen: "login",
          });
          wsClient.disconnect();
        }
      })
    );
  }

  /**
   * Subscribe to state changes.
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);

    // Call immediately with current state
    callback(this.state);

    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Get current state.
   */
  getState(): MultiplayerState {
    return this.state;
  }

  /**
   * Check if auth is enabled on the server.
   */
  isAuthEnabled(): boolean {
    return authClient.isAuthEnabled();
  }

  /**
   * Initiate login.
   */
  login(): void {
    authClient.login(window.location.pathname);
  }

  /**
   * Login with a display name (dev mode only).
   */
  loginWithName(name: string): void {
    authClient.loginWithName(name, window.location.pathname);
  }

  /**
   * Logout.
   */
  logout(): void {
    wsClient.disconnect();
    authClient.logout();
  }

  /**
   * Sync a character to the server.
   * Returns the server character ID to use for joining games.
   */
  private async syncCharacter(characterId: string): Promise<string> {
    console.log("[mp] syncCharacter called with ID:", characterId);

    // Get the local character from IndexedDB
    const localChar = await getCharacter(characterId);
    console.log("[mp] getCharacter result:", localChar ? `found: ${localChar.name}` : "NOT FOUND");

    if (!localChar) {
      // No local character found, use the ID directly (server-side character)
      console.warn("[mp] No local character found, using ID directly (may fail if not synced)");
      return characterId;
    }

    // Sync the character to the server
    try {
      const response = await wsClient.request<{
        id: string;
        level: number;
        xp: number;
        gold: number;
        silver: number;
      }>("sync_character", {
        character: {
          id: localChar.id,
          name: localChar.name,
          class: localChar.class,
          appearance: localChar.appearance,
          backstory: localChar.backstory,
        },
      });

      // Mark as synced in IndexedDB with server data
      await markSynced(localChar.id, {
        level: response.level,
        xp: response.xp,
        gold: response.gold,
        silver: response.silver,
      });

      console.log(`[mp] Character synced: ${localChar.name} (Level ${response.level})`);
      return response.id;
    } catch (error) {
      console.error("[mp] Failed to sync character:", error);
      // Fall back to using the character ID directly
      return characterId;
    }
  }

  /**
   * Create a new game session.
   */
  async createGame(characterId: string, config?: {
    maxPlayers?: number;
    difficulty?: "easy" | "normal" | "hard";
    turnTimeLimit?: number;
    npcCount?: number;
    npcClasses?: string[];
    monsterCount?: number;
    playerMoveRange?: number;
  }): Promise<void> {
    console.log("[mp] createGame started", { characterId, config });
    try {
      this.updateState({ screen: "loading" });

      // Sync character to server first
      console.log("[mp] Syncing character...");
      const syncedCharId = await this.syncCharacter(characterId);
      console.log("[mp] Character synced:", syncedCharId);

      console.log("[mp] Sending create_game request...");
      const result = await wsClient.createGame(syncedCharId, config);
      console.log("[mp] Game created:", result);

      this.updateState({
        screen: "lobby",
        sessionId: result.sessionId,
        joinCode: result.joinCode,
        isDM: true,
      });
      console.log("[mp] Updated state to lobby");
    } catch (error) {
      console.error("[mp] Failed to create game:", error);
      this.updateState({ screen: "main_menu" });
    }
  }

  /**
   * Join an existing game.
   */
  async joinGame(joinCode: string, characterId: string): Promise<void> {
    try {
      this.updateState({ screen: "loading" });

      // Sync character to server first
      const syncedCharId = await this.syncCharacter(characterId);

      const result = await wsClient.joinGame(joinCode, syncedCharId);

      this.updateState({
        screen: "lobby",
        sessionId: result.sessionId,
        joinCode,
        isDM: false,
      });
    } catch (error) {
      console.error("[mp] Failed to join game:", error);
      this.updateState({ screen: "main_menu" });
    }
  }

  /**
   * Leave the current game.
   */
  leaveGame(): void {
    wsClient.leaveGame();

    // Destroy chat UI
    if (this.chatUI) {
      this.chatUI.destroy();
      this.chatUI = null;
    }

    // Destroy DM controls
    if (this.dmControls) {
      this.dmControls.destroy();
      this.dmControls = null;
    }

    this.updateState({
      screen: "main_menu",
      sessionId: null,
      joinCode: null,
      isDM: false,
      players: [],
      gameState: null,
      stateVersion: 0,
      myUnitId: null,
      isMyTurn: false,
      turnInfo: null,
    });
  }

  /**
   * Navigate to party setup screen.
   */
  navigateToPartySetup(): void {
    this.updateState({ screen: "party_setup" });
  }

  /**
   * Go back to main menu from party setup.
   */
  backToMainMenu(): void {
    this.updateState({ screen: "main_menu" });
  }

  /**
   * Set ready status in lobby.
   */
  setReady(ready: boolean): void {
    wsClient.setReady(ready);
  }

  /**
   * Start the game (DM only).
   */
  async startGame(): Promise<void> {
    if (!this.state.isDM) {
      console.error("[mp] Only DM can start the game");
      return;
    }

    try {
      await wsClient.sendDMCommand({ command: "start_game" });
    } catch (error) {
      console.error("[mp] Failed to start game:", error);
    }
  }

  /**
   * Send a game action to the server.
   */
  async sendAction(action: {
    type: string;
    unitId?: string;
    path?: Position[];
    targetId?: string;
    lootId?: string;
  }): Promise<void> {
    if (this.state.pendingAction) {
      console.warn("[mp] Action already pending");
      return;
    }

    if (!this.state.isMyTurn) {
      console.warn("[mp] Not your turn");
      this.ui.addLogEntry("Not your turn!", "system");
      return;
    }

    this.updateState({ pendingAction: true });

    try {
      const result = await wsClient.sendAction(action);

      if (!result.valid) {
        console.warn("[mp] Action rejected:", result.reason);
        this.ui.addLogEntry(result.reason ?? "Invalid action", "damage");
      } else {
        // Auto-end turn after attack
        if (action.type === "attack") {
          this.ui.addLogEntry("Turn complete - attack finished", "turn");
          this.updateState({ pendingAction: false });
          // Send end_turn action
          await wsClient.sendAction({
            type: "end_turn",
            unitId: this.state.myUnitId ?? undefined,
          });
          return;
        }

        // Refresh move highlights after moving
        if (action.type === "move" && this.mode === "move" && this.state.gameState) {
          // State will be updated via state_delta, but we can update highlights
          // after a brief delay to let state update
          setTimeout(() => {
            if (this.state.gameState && this.state.isMyTurn) {
              this.validMoveTargets = getValidMoveTargets(this.state.gameState);
              console.log("[mp] Refreshed move targets after move:", this.validMoveTargets.length);
              this.renderer.clearHighlights();
              this.renderer.highlightTiles(this.validMoveTargets, "move");

              // Auto-end turn if no movement remaining
              const turnState = this.state.gameState.combat?.turnState;
              if (turnState && turnState.movementRemaining <= 0 && turnState.hasActed) {
                this.ui.addLogEntry("Turn complete - no actions remaining", "turn");
                this.sendAction({
                  type: "end_turn",
                  unitId: this.state.myUnitId ?? undefined,
                });
              }
            }
          }, 100);
        }
      }
    } catch (error) {
      console.error("[mp] Action failed:", error);
      this.ui.addLogEntry("Action failed", "damage");
    } finally {
      this.updateState({ pendingAction: false });
    }
  }

  /**
   * Send a chat message.
   */
  sendChat(message: string, target?: string): void {
    wsClient.sendChat(message, target);
  }

  /**
   * Send a DM command.
   */
  async sendDMCommand(command: unknown): Promise<void> {
    if (!this.state.isDM) {
      console.error("[mp] Only DM can send commands");
      return;
    }

    try {
      await wsClient.sendDMCommand(command);
    } catch (error) {
      console.error("[mp] DM command failed:", error);
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];

    // Destroy chat UI
    if (this.chatUI) {
      this.chatUI.destroy();
      this.chatUI = null;
    }

    // Destroy DM controls
    if (this.dmControls) {
      this.dmControls.destroy();
      this.dmControls = null;
    }

    wsClient.disconnect();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private updateState(partial: Partial<MultiplayerState>): void {
    this.state = { ...this.state, ...partial };

    for (const callback of this.listeners) {
      try {
        callback(this.state);
      } catch (error) {
        console.error("[mp] State listener error:", error);
      }
    }
  }

  private setupRendererHandlers(): void {
    // Handle tile clicks - send move action
    this.renderer.onTileClick = (pos) => {
      console.log("[mp] Tile clicked:", pos, "mode:", this.mode, "isMyTurn:", this.state.isMyTurn);
      if (!this.state.isMyTurn || this.state.pendingAction) return;
      if (this.mode !== "move") return;

      // Validate position is in valid move targets
      const isValid = this.validMoveTargets.some(
        (p) => p.x === pos.x && p.y === pos.y
      );
      console.log("[mp] Click valid?", isValid, "validTargets count:", this.validMoveTargets.length);
      if (!isValid) {
        this.ui.addLogEntry("Can't move there!", "system");
        return;
      }

      // Send move action (server will calculate full path)
      this.sendAction({
        type: "move",
        unitId: this.state.myUnitId ?? undefined,
        path: [pos],
      });
    };

    // Handle unit clicks - send attack action
    this.renderer.onUnitClick = (unitId) => {
      if (!this.state.isMyTurn || this.state.pendingAction) return;

      const target = this.state.gameState?.units.find((u) => u.id === unitId);
      if (!target) return;

      // In attack mode, attack if valid target
      if (this.mode === "attack") {
        const isValidTarget = this.validAttackTargets.some((u) => u.id === unitId);
        if (isValidTarget) {
          this.sendAction({
            type: "attack",
            unitId: this.state.myUnitId ?? undefined,
            targetId: unitId,
          });
        } else {
          this.ui.addLogEntry("Invalid target!", "system");
        }
      } else if (target.type === "monster") {
        // Switch to attack mode and highlight targets
        this.setMode("attack");
      }
    };

    // Handle loot clicks
    this.renderer.onLootClick = (lootId) => {
      if (!this.state.isMyTurn || this.state.pendingAction) return;

      this.sendAction({
        type: "collect_loot",
        unitId: this.state.myUnitId ?? undefined,
        lootId,
      });
    };
  }

  private setupWebSocketHandlers(): void {
    // Connection status
    this.cleanups.push(
      wsClient.on<ConnectionStatus>("status_change", (status) => {
        this.updateState({ connectionStatus: status });

        if (status === "connected") {
          // Restore screen based on session state
          if (this.state.sessionId) {
            // We're reconnected to a session, request sync
            wsClient.requestSync();
          }
          // Don't reset to main_menu - let the current screen flow continue
          // The appropriate screen transitions happen in createGame, joinGame, etc.
        }
      })
    );

    // Auth result
    this.cleanups.push(
      wsClient.on<{ userId: string; name: string; reconnectedSessionId?: string }>(
        "authenticated",
        (data) => {
          if (data.reconnectedSessionId) {
            this.updateState({
              sessionId: data.reconnectedSessionId,
            });
          }
        }
      )
    );

    // Lobby state
    this.cleanups.push(
      wsClient.on<LobbyStatePayload>("lobby_state", (payload) => {
        const isDM = payload.players.some(
          (p) => p.id === wsClient.userId && p.isDM
        );

        this.updateState({
          screen: payload.state === "playing" ? "game" : "lobby",
          players: payload.players,
          isDM,
        });

        // Update chat UI with player list for whispers
        if (this.chatUI) {
          this.chatUI.updatePlayers(
            payload.players.map((p) => ({ id: p.id, name: p.name }))
          );
        }

        // Update DM controls with player list
        if (this.dmControls) {
          this.dmControls.updatePlayers(
            payload.players.map((p) => ({ id: p.id, name: p.name }))
          );
        }
      })
    );

    // Full state sync
    this.cleanups.push(
      wsClient.on<FullStatePayload & { yourUnitId?: string }>(
        "full_state",
        (payload) => {
          const rawState = payload.gameState as GameState;

          console.log("[mp] Received full_state:", {
            hasMap: !!rawState?.map,
            mapSeed: rawState?.map?.seed,
            unitCount: rawState?.units?.length,
          });

          // Reconstruct the GameMap from serialized data
          // The map loses its getTile method when serialized, so regenerate it
          const mapSeed = rawState?.map?.seed ?? 12345; // fallback seed
          const reconstructedMap = generateMap({ seed: mapSeed });
          const gameState: GameState = {
            ...rawState,
            map: reconstructedMap,
          };

          // Determine if it's this player's turn from the game state
          const currentTurnUnitId = gameState.combat?.turnState?.unitId;
          const isMyTurn = currentTurnUnitId === payload.yourUnitId;

          this.updateState({
            screen: "game",
            gameState,
            stateVersion: payload.version,
            myUnitId: payload.yourUnitId ?? null,
            isMyTurn,
          });

          if (isMyTurn) {
            this.ui.addLogEntry("Your turn!", "turn");
          }

          // Create chat UI if not already created
          if (!this.chatUI) {
            this.chatUI = new ChatUI(this.container, {
              onSend: (message, target) => this.sendChat(message, target),
              players: this.state.players.map((p) => ({ id: p.id, name: p.name })),
            });
          }

          // Create DM controls if DM and not already created
          if (this.state.isDM && !this.dmControls) {
            this.dmControls = new DMControls(this.container, {
              onCommand: (command) => this.sendDMCommand(command),
            });
            this.dmControls.updatePlayers(
              this.state.players.map((p) => ({ id: p.id, name: p.name }))
            );
          }

          // Update DM controls with monster list
          if (this.dmControls && gameState.units) {
            this.dmControls.updateMonsters(gameState.units);
          }

          // Render the game state
          this.renderGameState(gameState);
        }
      )
    );

    // Delta state updates
    this.cleanups.push(
      wsClient.on<DeltaStatePayload>(
        "state_delta",
        (payload) => {
          // Apply delta to current state
          if (this.state.gameState && payload.delta) {
            console.log("[mp] state_delta received:", {
              fromVersion: payload.delta.fromVersion,
              toVersion: payload.delta.toVersion,
              changeCount: payload.delta.changes?.length,
              changePaths: payload.delta.changes?.map((c: { path: string }) => c.path), // Show what changed
            });

            const newState = this.applyDelta(
              this.state.gameState,
              payload.delta.changes
            );

            console.log("[mp] After applyDelta:", {
              phase: newState.combat?.phase,
              turnUnitId: newState.combat?.turnState?.unitId,
              movementRemaining: newState.combat?.turnState?.movementRemaining,
              hasGetTile: typeof newState.map?.getTile === "function",
            });

            this.updateState({
              gameState: newState,
              stateVersion: payload.delta.toVersion,
            });

            // Re-render
            this.renderGameState(newState);
          }
        }
      )
    );

    // Game events
    this.cleanups.push(
      wsClient.on<EventsPayload>("events", (payload) => {
        for (const event of payload.events) {
          // Cast shared GameEvent to simulation GameEvent (compatible at runtime)
          this.handleGameEvent(event as unknown as GameEvent);
        }
      })
    );

    // Turn change
    this.cleanups.push(
      wsClient.on<TurnChangeInfo>("turn_change", (turnInfo) => {
        const isMyTurn = turnInfo.currentUserId === wsClient.userId;

        console.log("[mp] turn_change received:", {
          currentUnitId: turnInfo.currentUnitId,
          currentUserId: turnInfo.currentUserId,
          myUserId: wsClient.userId,
          isMyTurn,
          turnNumber: turnInfo.turnNumber,
          isPlayerTurn: turnInfo.isPlayerTurn,
        });

        this.updateState({
          turnInfo,
          isMyTurn,
        });

        if (isMyTurn) {
          this.ui.addLogEntry("Your turn!", "turn");
          // Center on player's unit
          if (this.state.gameState && this.state.myUnitId) {
            const myUnit = this.state.gameState.units.find(
              (u) => u.id === this.state.myUnitId
            );
            if (myUnit) {
              this.renderer.centerOnPosition(myUnit.position, true);
            }
          }

          // Log game state before calling setMode
          console.log("[mp] About to call setMode('move'). GameState combat:", {
            phase: this.state.gameState?.combat?.phase,
            turnUnitId: this.state.gameState?.combat?.turnState?.unitId,
            myUnitId: this.state.myUnitId,
            movementRemaining: this.state.gameState?.combat?.turnState?.movementRemaining,
            hasGetTile: typeof this.state.gameState?.map?.getTile === "function",
          });

          // Show movement highlights
          this.setMode("move");
        } else {
          // Not my turn, clear highlights
          this.setMode("idle");
        }
      })
    );

    // Player events
    this.cleanups.push(
      wsClient.on("player_joined", (data: { userId: string; name: string }) => {
        this.ui.addLogEntry(`${data.name} joined the game`, "turn");
      })
    );

    this.cleanups.push(
      wsClient.on(
        "player_disconnected",
        (data: { userId: string; name?: string }) => {
          this.ui.addLogEntry(
            `${data.name ?? data.userId} disconnected`,
            "system"
          );
        }
      )
    );

    this.cleanups.push(
      wsClient.on(
        "player_reconnected",
        (data: { userId: string; name?: string }) => {
          this.ui.addLogEntry(
            `${data.name ?? data.userId} reconnected`,
            "turn"
          );
        }
      )
    );

    this.cleanups.push(
      wsClient.on(
        "player_left",
        (data: { userId: string; reason?: string }) => {
          this.ui.addLogEntry(`Player left: ${data.reason ?? "unknown"}`, "system");
        }
      )
    );

    // Chat
    this.cleanups.push(
      wsClient.on(
        "chat_received",
        (data: {
          from: string;
          fromName: string;
          message: string;
          isWhisper: boolean;
        }) => {
          if (this.chatUI) {
            this.chatUI.addMessage({
              from: data.from,
              fromName: data.fromName,
              message: data.message,
              isWhisper: data.isWhisper,
              isSystem: false,
            });
          } else {
            // Fallback to game log if chat UI not yet created
            const prefix = data.isWhisper ? "[whisper] " : "";
            this.ui.addLogEntry(`${prefix}${data.fromName}: ${data.message}`, "system");
          }
        }
      )
    );

    // Game pause/resume
    this.cleanups.push(
      wsClient.on("game_paused", () => {
        console.log("[mp] Game paused");
        this.updateState({ isPaused: true });
        this.ui.showPauseOverlay(true);
        this.ui.addLogEntry("Game paused", "turn");
        if (this.dmControls) {
          this.dmControls.setPaused(true);
        }
      })
    );

    this.cleanups.push(
      wsClient.on("game_resumed", () => {
        console.log("[mp] Game resumed");
        this.updateState({ isPaused: false });
        this.ui.showPauseOverlay(false);
        this.ui.addLogEntry("Game resumed", "turn");
        if (this.dmControls) {
          this.dmControls.setPaused(false);
        }
      })
    );
  }

  /**
   * Set the current interaction mode and highlight valid targets.
   */
  private setMode(mode: MultiplayerMode): void {
    try {
      this.mode = mode;
      this.renderer.clearHighlights();
      this.validMoveTargets = [];
      this.validAttackTargets = [];

      if (!this.state.gameState || !this.state.isMyTurn) {
        this.mode = "idle";
        return;
      }

      // Verify map has getTile method (critical for pathfinding)
      if (typeof this.state.gameState.map?.getTile !== "function") {
        console.error("[mp] setMode: map.getTile is not a function! Reconstructing map...");
        const mapSeed = this.state.gameState.map?.seed ?? 12345;
        this.updateState({
          gameState: { ...this.state.gameState, map: generateMap({ seed: mapSeed }) },
        });
      }

      switch (mode) {
        case "move":
          this.validMoveTargets = getValidMoveTargets(this.state.gameState);
          console.log("[mp] Valid move targets:", this.validMoveTargets.length, this.validMoveTargets.slice(0, 5));
          console.log("[mp] Combat state:", {
            phase: this.state.gameState.combat.phase,
            turnUnitId: this.state.gameState.combat.turnState?.unitId,
            myUnitId: this.state.myUnitId,
            movementRemaining: this.state.gameState.combat.turnState?.movementRemaining,
          });
          this.renderer.highlightTiles(this.validMoveTargets, "move");
          break;

        case "attack":
          this.validAttackTargets = getValidAttackTargets(this.state.gameState);
          const attackPositions = this.validAttackTargets.map((u) => u.position);
          this.renderer.highlightTiles(attackPositions, "attack");
          break;
      }

      // Update action buttons
      const hasValidTargets = this.validAttackTargets.length > 0 ||
        (this.state.gameState && getValidAttackTargets(this.state.gameState).length > 0);
      this.ui.updateActionButtons(
        mode === "idle" ? "menu" : mode,
        this.state.gameState.combat.turnState,
        hasValidTargets
      );
    } catch (error) {
      console.error("[mp] setMode error:", error);
      // Reset to idle on error to prevent broken state
      this.mode = "idle";
      this.validMoveTargets = [];
      this.validAttackTargets = [];
    }
  }

  /**
   * Set up sprites for all units based on their names.
   * Maps unit names to character/monster types to get sprite paths.
   */
  private setupUnitSprites(units: ReadonlyArray<Unit>): void {
    const sprites = new Map<string, string>();

    for (const unit of units) {
      if (unit.type === "monster") {
        // Extract monster type from name (e.g., "Goblin 1" -> "Goblin")
        const typeName = unit.name.replace(/\s+\d+$/, "");
        const monsterType = MONSTER_TYPES.find(
          (m) => m.name.toLowerCase() === typeName.toLowerCase()
        );
        if (monsterType) {
          sprites.set(unit.id, monsterType.sprite);
        }
      } else if (unit.type === "npc") {
        // NPCs use character class sprites
        // The NPC name might be like "Warrior Companion" or just a class name
        const className = unit.name.split(" ")[0]?.toLowerCase() ?? "";
        const charClass = CHARACTER_CLASSES.find(
          (c) => c.id === className || c.name.toLowerCase() === className
        );
        if (charClass) {
          sprites.set(unit.id, charClass.sprite);
        }
      } else if (unit.type === "player") {
        // For players, we'd need character data from the server
        // For now, try to match by name or use a default
        const className = unit.name.split(" ")[0]?.toLowerCase() ?? "";
        const charClass = CHARACTER_CLASSES.find(
          (c) => c.id === className || c.name.toLowerCase() === className
        );
        if (charClass) {
          sprites.set(unit.id, charClass.sprite);
        }
      }
    }

    this.renderer.setUnitSprites(sprites);
  }

  private renderGameState(gameState: GameState): void {
    // Set up sprites for units (maps names to sprite paths)
    this.setupUnitSprites(gameState.units);

    // Find player unit for centering
    const myUnit = gameState.units.find((u) => u.id === this.state.myUnitId);
    const centerPos = myUnit?.position ?? { x: 0, y: 0 };

    // Render map centered on player
    this.renderer.renderMap(gameState.map, centerPos);

    // Center camera on player position
    this.renderer.centerCamera(centerPos);

    // Render units
    this.renderer.renderUnits(gameState.units);

    // Render loot drops
    for (const loot of gameState.lootDrops) {
      this.renderer.addLootBag(loot);
    }

    // Update UI
    this.ui.hideStartScreen();
    this.ui.hideCharacterSelect();
    this.ui.showActionBar();

    // Update initiative tracker
    this.ui.updateInitiativeTracker(
      gameState.combat.initiativeOrder,
      gameState.units,
      gameState.combat.currentTurnIndex
    );

    // Update inventory
    this.ui.updateInventory(gameState.playerInventory);

    // Update DM controls monster list
    if (this.dmControls) {
      this.dmControls.updateMonsters(gameState.units);
    }

    // Set mode based on turn state
    if (this.state.isMyTurn) {
      this.setMode("move");
    } else {
      this.setMode("idle");
    }
  }

  private handleGameEvent(event: GameEvent): void {
    switch (event.type) {
      case "combat_started":
        this.ui.addLogEntry("Combat begins!", "turn");
        break;

      case "turn_started": {
        const unit = this.state.gameState?.units.find(
          (u) => u.id === event.unitId
        );
        if (unit) {
          this.ui.addLogEntry(`${unit.name}'s turn`, "turn");
          this.renderer.selectUnit(unit.id);
          this.ui.showUnitPanel(unit);
        }
        break;
      }

      case "unit_moved": {
        const unit = this.state.gameState?.units.find(
          (u) => u.id === event.unitId
        );
        if (unit) {
          this.ui.addLogEntry(`${unit.name} moved`, "move");
        }
        break;
      }

      case "unit_attacked": {
        const attacker = this.state.gameState?.units.find(
          (u) => u.id === event.attackerId
        );
        const target = this.state.gameState?.units.find(
          (u) => u.id === event.targetId
        );
        if (attacker && target) {
          this.ui.addLogEntry(
            `${attacker.name} attacks ${target.name}`,
            "damage"
          );
        }
        break;
      }

      case "unit_damaged": {
        const unit = this.state.gameState?.units.find(
          (u) => u.id === event.unitId
        );
        if (unit) {
          this.ui.addLogEntry(
            `${unit.name} takes ${event.damage} damage (${event.remainingHp} HP)`,
            "damage"
          );
        }
        break;
      }

      case "unit_defeated": {
        const unit = this.state.gameState?.units.find(
          (u) => u.id === event.unitId
        );
        if (unit) {
          this.ui.addLogEntry(`${unit.name} is defeated!`, "damage");
        }
        break;
      }

      case "combat_ended":
        if (event.result === "victory") {
          this.ui.addLogEntry("VICTORY!", "victory");
        } else {
          this.ui.addLogEntry("DEFEAT!", "defeat");
        }
        break;

      case "loot_dropped":
        this.ui.addLogEntry("Loot dropped!", "turn");
        this.renderer.addLootBag(event.lootDrop);
        break;

      case "loot_collected":
        this.ui.addLogEntry("Collected loot!", "victory");
        this.renderer.removeLootBag(event.lootDropId);
        break;
    }
  }

  private applyDelta(
    state: GameState,
    changes: Array<{ path: string; value: unknown }>
  ): GameState {
    // Deep clone the state (use Record type to allow mutation during construction)
    const mutableState = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;

    for (const change of changes) {
      this.setValueAtPath(mutableState, change.path, change.value);
    }

    // CRITICAL: The map loses its getTile method after JSON serialization.
    // We must reconstruct it from the seed to restore the method.
    const existingMap = mutableState.map as { seed?: number } | undefined;
    const mapSeed = existingMap?.seed ?? state.map?.seed ?? 12345;
    mutableState.map = generateMap({ seed: mapSeed });

    return mutableState as unknown as GameState;
  }

  private setValueAtPath(
    obj: unknown,
    path: string,
    value: unknown
  ): void {
    const parts = path.split(".");
    let current = obj as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      const index = parseInt(part, 10);

      if (!isNaN(index) && Array.isArray(current)) {
        current = current[index] as Record<string, unknown>;
      } else {
        current = current[part] as Record<string, unknown>;
      }
    }

    const lastPart = parts[parts.length - 1]!;
    const lastIndex = parseInt(lastPart, 10);

    if (!isNaN(lastIndex) && Array.isArray(current)) {
      (current as unknown[])[lastIndex] = value;
    } else {
      current[lastPart] = value;
    }
  }
}
