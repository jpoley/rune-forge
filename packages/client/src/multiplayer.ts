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
import type {
  GameState,
  GameEvent,
  Position,
  Unit,
} from "@rune-forge/simulation";
import type {
  FullStatePayload,
  DeltaStatePayload,
  EventsPayload,
  ActionResultPayload,
  LobbyStatePayload,
} from "@rune-forge/shared";

// =============================================================================
// Types
// =============================================================================

/** Multiplayer screen state */
export type MultiplayerScreen =
  | "login"
  | "main_menu"
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
}

/** State change callback */
type StateChangeCallback = (state: MultiplayerState) => void;

// =============================================================================
// Multiplayer Controller
// =============================================================================

export class MultiplayerController {
  private renderer: IsometricRenderer;
  private ui: GameUI;

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
  };

  private listeners = new Set<StateChangeCallback>();

  // Cleanup functions for subscriptions
  private cleanups: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.renderer = new IsometricRenderer(container);
    this.ui = new GameUI();

    this.setupRendererHandlers();
    this.setupWebSocketHandlers();
    this.renderer.startRenderLoop();
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

      // Connect WebSocket - server authenticates from cookie during upgrade
      // (session cookie is HttpOnly so we can't read it in JS)
      wsClient.connect();
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
          // Server authenticates from cookie during upgrade
          if (!wsClient.isConnected()) {
            wsClient.connect();
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
   * Initiate login with Pocket ID.
   */
  login(): void {
    // Include query string to preserve ?mode=multi
    const redirectUri = window.location.pathname + window.location.search;
    authClient.login(redirectUri);
  }

  /**
   * Dev login (no OIDC required).
   */
  devLogin(name: string): void {
    // Include query string to preserve ?mode=multi
    const redirectUri = window.location.pathname + window.location.search;
    authClient.devLogin(name, redirectUri);
  }

  /**
   * Logout.
   */
  logout(): void {
    wsClient.disconnect();
    authClient.logout();
  }

  /**
   * Create a new game session.
   */
  async createGame(characterId: string, config?: {
    maxPlayers?: number;
    difficulty?: "easy" | "normal" | "hard";
    turnTimeLimit?: number;
  }): Promise<void> {
    try {
      this.updateState({ screen: "loading" });

      const result = await wsClient.createGame(characterId, config);

      this.updateState({
        screen: "lobby",
        sessionId: result.sessionId,
        joinCode: result.joinCode,
        isDM: true,
      });
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

      const result = await wsClient.joinGame(joinCode, characterId);

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
   * List user's characters.
   */
  async listCharacters(): Promise<{
    characters: Array<{ id: string; name: string; class: string; level: number }>;
  }> {
    return wsClient.listCharacters();
  }

  /**
   * Create a new character.
   */
  async createCharacter(
    name: string,
    characterClass: string
  ): Promise<{ id: string; name: string; class: string; level: number }> {
    return wsClient.createCharacter(
      name,
      characterClass as "warrior" | "ranger" | "mage" | "rogue"
    );
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
      if (!this.state.isMyTurn || this.state.pendingAction) return;
      if (!this.state.myUnitId) return; // Need unit ID to send actions

      // Send move action (server will validate)
      this.sendAction({
        type: "move",
        unitId: this.state.myUnitId,
        path: [pos], // Server will calculate full path
      });
    };

    // Handle unit clicks - send attack action
    this.renderer.onUnitClick = (unitId) => {
      if (!this.state.isMyTurn || this.state.pendingAction) return;
      if (!this.state.myUnitId) return; // Need unit ID to send actions

      const target = this.state.gameState?.units.find((u) => u.id === unitId);
      if (target && target.type === "monster") {
        this.sendAction({
          type: "attack",
          unitId: this.state.myUnitId,
          targetId: unitId,
        });
      }
    };

    // Handle loot clicks
    this.renderer.onLootClick = (lootId) => {
      if (!this.state.isMyTurn || this.state.pendingAction) return;
      if (!this.state.myUnitId) return; // Need unit ID to send actions

      this.sendAction({
        type: "collect_loot",
        unitId: this.state.myUnitId,
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
          } else {
            this.updateState({ screen: "main_menu" });
          }
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
      })
    );

    // Full state sync
    this.cleanups.push(
      wsClient.on<FullStatePayload & { yourUnitId?: string }>(
        "full_state",
        (payload) => {
          const gameState = payload.gameState as GameState;

          this.updateState({
            screen: "game",
            gameState,
            stateVersion: payload.version,
            myUnitId: payload.yourUnitId ?? null,
          });

          // Render the game state
          this.renderGameState(gameState);
        }
      )
    );

    // Delta state updates
    this.cleanups.push(
      wsClient.on<{ delta: { fromVersion: number; toVersion: number; changes: Array<{ path: string; value: unknown }> } }>(
        "state_delta",
        (payload) => {
          // Apply delta to current state
          if (this.state.gameState && payload.delta) {
            const newState = this.applyDelta(
              this.state.gameState,
              payload.delta.changes
            );

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
          // Cast from shared GameEvent to simulation GameEvent (runtime compatible)
          this.handleGameEvent(event as unknown as GameEvent);
        }
      })
    );

    // Turn change
    this.cleanups.push(
      wsClient.on<TurnChangeInfo>("turn_change", (turnInfo) => {
        const isMyTurn = turnInfo.currentUserId === wsClient.userId;

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
          const prefix = data.isWhisper ? "[whisper] " : "";
          this.ui.addLogEntry(`${prefix}${data.fromName}: ${data.message}`, "system");
        }
      )
    );
  }

  private renderGameState(gameState: GameState): void {
    // Find player unit for centering
    const myUnit = gameState.units.find((u) => u.id === this.state.myUnitId);
    const centerPos = myUnit?.position ?? { x: 0, y: 0 };

    // Render map centered on player
    this.renderer.renderMap(gameState.map, centerPos);

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
    // Deep clone the state
    const newState = JSON.parse(JSON.stringify(state)) as GameState;

    for (const change of changes) {
      this.setValueAtPath(newState, change.path, change.value);
    }

    return newState;
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
