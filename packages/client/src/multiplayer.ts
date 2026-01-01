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
import { getCharacter, markSynced, type LocalCharacter } from "./db/character-db.js";
import { getMonsterTypeByName, getCharacterClass } from "./characters.js";
import {
  generateMap,
  findPath,
  getValidMoveTargets,
  type GameState,
  type GameEvent,
  type Position,
  type Unit,
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

  // Action mode state
  private actionMode: "move" | "attack" | "idle" = "idle";
  private validMoveTargets: Position[] = [];

  constructor(container: HTMLElement) {
    this.renderer = new IsometricRenderer(container);
    this.ui = new GameUI();

    this.setupRendererHandlers();
    this.setupUIHandlers();
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

          // Connect WebSocket if not already connecting/connected
          // Server authenticates from cookie during upgrade
          if (!wsClient.isConnectedOrConnecting()) {
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
   * Navigate to a specific screen (for client-side navigation).
   */
  navigateToScreen(screen: MultiplayerScreen): void {
    this.updateState({ screen });
  }

  /**
   * Ensure character exists on server before creating/joining a game.
   * Handles both local characters (synced to server) and server-created characters.
   */
  private async ensureCharacterOnServer(characterId: string): Promise<boolean> {
    console.log("[mp] ensureCharacterOnServer called with:", characterId);

    // First, try to find in local storage
    const localChar = await getCharacter(characterId);
    console.log("[mp] Local character lookup result:", localChar ? `Found: ${localChar.name}` : "Not found");

    if (localChar) {
      // Character exists locally - sync to server
      try {
        console.log("[mp] Syncing local character to server:", {
          id: localChar.id,
          name: localChar.name,
          class: localChar.class,
        });

        const serverData = await wsClient.syncCharacter({
          id: localChar.id,
          name: localChar.name,
          class: localChar.class,
          appearance: localChar.appearance,
          backstory: localChar.backstory,
        });

        // Update local storage to mark as synced
        await markSynced(characterId, {
          level: serverData.level,
          xp: serverData.xp,
          gold: serverData.gold,
          silver: serverData.silver,
        });

        console.log("[mp] Character synced successfully:", serverData);
        return true;
      } catch (error) {
        console.error("[mp] Failed to sync character to server:", error);
        return false;
      }
    }

    // Character not in local storage - might have been created directly on server
    // (e.g., via screens.ts onCreateCharacter flow)
    // In this case, just assume it exists on server and proceed
    console.log("[mp] Character not in local storage, assuming server-created:", characterId);
    return true;
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
    try {
      this.updateState({ screen: "loading" });

      // Ensure character exists on server before creating game
      const ready = await this.ensureCharacterOnServer(characterId);
      if (!ready) {
        console.error("[mp] Failed to ensure character on server, cannot create game");
        this.updateState({ screen: "main_menu" });
        return;
      }

      const result = await wsClient.createGame(characterId, config);

      this.updateState({
        screen: "lobby",
        sessionId: result.sessionId,
        joinCode: result.joinCode,
        isDM: true,
      });
    } catch (error) {
      // If already in a session, leave it and retry
      if (error instanceof Error && error.message === "ALREADY_IN_SESSION") {
        console.log("[mp] Already in session, leaving and retrying...");
        wsClient.leaveGame();
        // Wait a moment for the leave to process
        await new Promise(resolve => setTimeout(resolve, 100));
        // Retry create
        try {
          const result = await wsClient.createGame(characterId, config);
          this.updateState({
            screen: "lobby",
            sessionId: result.sessionId,
            joinCode: result.joinCode,
            isDM: true,
          });
          return;
        } catch (retryError) {
          console.error("[mp] Retry failed:", retryError);
        }
      }
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

      // Ensure character exists on server before joining game
      const ready = await this.ensureCharacterOnServer(characterId);
      if (!ready) {
        console.error("[mp] Failed to ensure character on server, cannot join game");
        this.updateState({ screen: "main_menu" });
        return;
      }

      const result = await wsClient.joinGame(joinCode, characterId);

      this.updateState({
        screen: "lobby",
        sessionId: result.sessionId,
        joinCode,
        isDM: false,
      });
    } catch (error) {
      // If already in a session, leave it and retry
      if (error instanceof Error && error.message === "ALREADY_IN_SESSION") {
        console.log("[mp] Already in session, leaving and retrying...");
        wsClient.leaveGame();
        // Wait a moment for the leave to process
        await new Promise(resolve => setTimeout(resolve, 100));
        // Retry join
        try {
          const result = await wsClient.joinGame(joinCode, characterId);
          this.updateState({
            screen: "lobby",
            sessionId: result.sessionId,
            joinCode,
            isDM: false,
          });
          return;
        } catch (retryError) {
          console.error("[mp] Retry failed:", retryError);
        }
      }
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
   * @param monsterTypes Array of monster type IDs to spawn (e.g., ["goblin", "orc", "skeleton"])
   */
  async startGame(monsterTypes: string[] = []): Promise<void> {
    if (!this.state.isDM) {
      console.error("[mp] Only DM can start the game");
      return;
    }

    try {
      await wsClient.sendDMCommand({ command: "start_game", monsterTypes });
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

        // RESILIENCE: Request state sync on action rejection to fix potential state mismatch
        console.log("[mp] Requesting state sync after rejection...");
        wsClient.requestSync();

        // Recalculate highlights after sync arrives (handled by full_state handler)
      }
    } catch (error) {
      console.error("[mp] Action failed:", error);
      this.ui.addLogEntry("Action failed - retrying sync", "damage");

      // RESILIENCE: Request state sync on error
      wsClient.requestSync();
    } finally {
      this.updateState({ pendingAction: false });
      // Note: Don't recalculate highlights here - let state_delta handler do it
      // This avoids race conditions with state updates arriving asynchronously
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
      if (!this.state.myUnitId || !this.state.gameState) return;

      // Find my unit to get current position
      const myUnit = this.state.gameState.units.find(
        (u) => u.id === this.state.myUnitId
      );
      if (!myUnit) return;

      // Check movement remaining first
      const movementRemaining = this.state.gameState.combat.turnState?.movementRemaining ?? 0;
      if (movementRemaining <= 0) {
        this.ui.addLogEntry("No movement remaining", "damage");
        return;
      }

      // Check if this is a valid move target
      // If validMoveTargets seems stale (different unit position), recalculate
      let isValidTarget = this.validMoveTargets.some(
        (t) => t.x === pos.x && t.y === pos.y
      );

      // RESILIENCE: If not in cached targets but we have movement, try recalculating
      if (!isValidTarget && movementRemaining > 0) {
        console.log("[mp] Target not in cached list, recalculating valid moves...");
        this.validMoveTargets = getValidMoveTargets(this.state.gameState);
        this.renderer.highlightTiles(this.validMoveTargets, "move");
        isValidTarget = this.validMoveTargets.some(
          (t) => t.x === pos.x && t.y === pos.y
        );
      }

      if (!isValidTarget) {
        console.warn("[mp] Invalid move target:", pos, "Unit at:", myUnit.position, "Movement:", movementRemaining);
        this.ui.addLogEntry("Cannot move there", "system");
        return;
      }

      // Calculate full path from current position to target
      let path = findPath(
        myUnit.position,
        pos,
        this.state.gameState.map,
        this.state.gameState.units,
        myUnit.id
      );
      if (!path || path.length === 0) {
        console.warn("[mp] No path found to target:", pos);
        this.ui.addLogEntry("No path to destination", "system");
        return;
      }

      // PRE-VALIDATE: Check path length against movement remaining (resilience fix)
      const pathCost = path.length - 1; // First tile is current position

      if (pathCost > movementRemaining) {
        console.warn(`[mp] Path too long: ${pathCost} > ${movementRemaining} movement remaining`);

        // Truncate path to maximum reachable distance
        if (movementRemaining > 0) {
          path = path.slice(0, movementRemaining + 1);
          console.log(`[mp] Truncated path to ${path.length - 1} steps`);
          this.ui.addLogEntry(`Moving ${path.length - 1} steps (max range)`, "move");
        } else {
          this.ui.addLogEntry("No movement remaining", "damage");
          return;
        }
      }

      // Clear highlights while action is pending
      this.renderer.clearHighlights();

      // Send move action with full path
      this.sendAction({
        type: "move",
        unitId: this.state.myUnitId,
        path,
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

  private setupUIHandlers(): void {
    // End Turn button
    this.ui.onEndTurn = () => {
      if (!this.state.isMyTurn || this.state.pendingAction) {
        console.log("[mp] Cannot end turn - not my turn or action pending");
        return;
      }
      if (!this.state.myUnitId) {
        console.log("[mp] Cannot end turn - no unit ID");
        return;
      }

      console.log("[mp] Ending turn");
      this.validMoveTargets = [];
      this.renderer.clearHighlights();
      this.actionMode = "idle";

      this.sendAction({
        type: "end_turn",
      });
    };

    // Move button - show movement highlights
    this.ui.onMoveAction = () => {
      if (!this.state.isMyTurn) return;
      this.showMovementHighlightsIfReady();
    };

    // Attack button - switch to attack mode
    this.ui.onAttackAction = () => {
      if (!this.state.isMyTurn) return;
      this.actionMode = "attack";
      this.renderer.clearHighlights();
      this.ui.addLogEntry("Click a monster to attack", "system");
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
          // GameMap methods (like getTile) are lost during JSON serialization.
          // We need to reconstruct the map using the seed from the server.
          const rawState = payload.gameState as GameState;
          const reconstructedMap = generateMap({
            seed: rawState.map.seed,
            name: rawState.map.name,
          });
          const gameState: GameState = {
            ...rawState,
            map: reconstructedMap,
          };

          this.updateState({
            screen: "game",
            gameState,
            stateVersion: payload.version,
            myUnitId: payload.yourUnitId ?? null,
          });

          // Render the game state
          this.renderGameState(gameState);

          // Show movement highlights if it's my turn
          this.showMovementHighlightsIfReady();
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

            // Recalculate movement highlights if it's still my turn
            this.showMovementHighlightsIfReady();
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
        const previouslyMyTurn = this.state.isMyTurn;

        // Don't manually update turnState here - let state_delta handle it
        // The state_delta arrives separately and contains the full updated combat state
        // including the correct movementRemaining for the new turn

        this.updateState({
          turnInfo,
          isMyTurn,
        });

        if (isMyTurn) {
          // If it's now my turn but wasn't before, request a sync to ensure state is current
          // This handles the case where state_delta and turn_change arrive in different orders
          if (!previouslyMyTurn) {
            this.ui.addLogEntry("Your turn!", "turn");
            // Use small delay to let state_delta arrive first, then show highlights
            setTimeout(() => {
              // If state shows a different turn unit, request sync
              const turnUnitId = this.state.gameState?.combat?.turnState?.unitId;
              if (turnUnitId !== turnInfo.currentUnitId) {
                console.log("[mp] Turn state not updated yet, requesting sync...");
                wsClient.requestSync();
              } else {
                this.showMovementHighlightsIfReady();
              }
            }, 50);
          } else {
            // Still my turn (e.g., after move action) - show highlights if state is ready
            this.showMovementHighlightsIfReady();
          }
        } else {
          // Not my turn - clear highlights
          this.validMoveTargets = [];
          this.renderer.clearHighlights();
          this.actionMode = "idle";
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
    // Assign sprites and colors to units before rendering
    const unitSprites = new Map<string, string>();
    const unitColors = new Map<string, number>();

    for (const unit of gameState.units) {
      if (unit.type === "monster") {
        // Look up monster sprite by name
        const monsterType = getMonsterTypeByName(unit.name);
        if (monsterType) {
          unitSprites.set(unit.id, monsterType.sprite);
          unitColors.set(unit.id, monsterType.color);
        }
      } else if (unit.type === "player") {
        // Check if this is an NPC (has "the ClassName" suffix) or the player's unit
        const classMatch = unit.name.match(/the (\w+)$/i);
        if (classMatch) {
          // NPC with class in name - look up class sprite
          const className = classMatch[1]!.toLowerCase();
          const charClass = getCharacterClass(className);
          if (charClass) {
            unitSprites.set(unit.id, charClass.sprite);
            unitColors.set(unit.id, charClass.color);
          } else {
            // Fallback to yellow
            unitColors.set(unit.id, 0xffcc00);
          }
        } else if (unit.id === this.state.myUnitId) {
          // This is the player's character - use gold color
          unitColors.set(unit.id, 0xffcc00);
        } else {
          // Other player or NPC without class suffix
          unitColors.set(unit.id, 0x66ff66); // Light green for allies
        }
      }
    }

    // Pass sprites and colors to renderer
    this.renderer.setUnitSprites(unitSprites);
    this.renderer.setUnitColors(unitColors);

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

  /**
   * Show movement highlights if it's the player's turn and game state is ready.
   * This is called from multiple places (full_state, turn_change, state_delta)
   * to handle the case where these events arrive in different orders.
   */
  private showMovementHighlightsIfReady(): void {
    // Need all conditions: it's my turn, I have a unit ID, and game state is loaded
    if (!this.state.isMyTurn || !this.state.myUnitId || !this.state.gameState) {
      // Clear highlights if not my turn
      if (!this.state.isMyTurn) {
        this.validMoveTargets = [];
        this.renderer.clearHighlights();
        this.actionMode = "idle";
      }
      return;
    }

    // Verify combat state is properly initialized
    if (!this.state.gameState.combat?.turnState) {
      console.warn("[mp] Game state not ready for movement highlights");
      return;
    }

    const myUnit = this.state.gameState.units.find(
      (u) => u.id === this.state.myUnitId
    );
    if (!myUnit) {
      console.warn("[mp] My unit not found in game state");
      return;
    }

    // Center on player's unit
    this.renderer.centerOnPosition(myUnit.position, true);

    // Check if the turn state matches my unit
    const turnUnitId = this.state.gameState.combat.turnState.unitId;
    if (turnUnitId !== this.state.myUnitId) {
      // The turn_change says it's my turn, but combat.turnState has a different unit
      // This can happen due to state sync timing - request a sync to fix it
      console.log("[mp] Turn state mismatch - requesting sync. My unit:", myUnit.id, "Turn unit:", turnUnitId);
      wsClient.requestSync();
      return;
    }

    // Check movement remaining
    const movementRemaining = this.state.gameState.combat.turnState.movementRemaining ?? 0;

    if (movementRemaining > 0) {
      // Calculate and show valid move targets
      this.validMoveTargets = getValidMoveTargets(this.state.gameState);
      this.renderer.highlightTiles(this.validMoveTargets, "move");
      this.actionMode = "move";
      console.log(`[mp] Calculated ${this.validMoveTargets.length} valid move targets (${movementRemaining} movement remaining)`);
    } else {
      // No movement remaining - clear move highlights
      this.validMoveTargets = [];
      this.renderer.clearHighlights();
      this.actionMode = "idle";
    }

    // Select the unit visually
    this.renderer.selectUnit(myUnit.id);
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
    // Deep clone the state (but preserve the map with its getTile method)
    const originalMap = state.map;
    const newState = JSON.parse(JSON.stringify(state)) as GameState;

    for (const change of changes) {
      this.setValueAtPath(newState, change.path, change.value);
    }

    // Restore the map with its getTile function (JSON.stringify loses methods)
    // If map seed changed, we'd need to regenerate, but typically only units/combat change
    return {
      ...newState,
      map: originalMap,
    };
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
