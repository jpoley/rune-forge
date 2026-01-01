/**
 * WebSocket Client
 *
 * Manages WebSocket connection with authentication, reconnection,
 * and message handling.
 */

import {
  MessageType,
  type WSMessage,
  type WSResponse,
  type AuthResultPayload,
  type LobbyStatePayload,
  type ActionResultPayload,
  type ChatReceivedPayload,
  type FullStatePayload,
  type DeltaStatePayload,
  type EventsPayload,
  type ErrorPayload,
  type GameEvent,
} from "@rune-forge/shared";
import type { GameState } from "@rune-forge/simulation";

// =============================================================================
// Types
// =============================================================================

/** Connection status */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting";

/** Event listener type */
type EventCallback<T = unknown> = (payload: T) => void;

/** Player info for lobby updates */
export interface PlayerInfo {
  id: string;
  name: string;
  characterName: string;
  ready: boolean;
  isDM: boolean;
  connected: boolean;
}

/** Turn change info */
export interface TurnChangeInfo {
  currentUnitId: string;
  currentUserId: string | null;
  turnNumber: number;
  isPlayerTurn: boolean;
}

// =============================================================================
// Configuration
// =============================================================================

/** Initial reconnection delay in ms */
const INITIAL_RECONNECT_DELAY_MS = 1000;

/** Max reconnection delay in ms */
const MAX_RECONNECT_DELAY_MS = 30000;

/** Reconnect backoff multiplier */
const RECONNECT_BACKOFF = 1.5;

/** Ping interval in ms */
const PING_INTERVAL_MS = 30000;

/** Pong timeout in ms */
const PONG_TIMEOUT_MS = 5000;

// =============================================================================
// WebSocket Client
// =============================================================================

export class WSClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private sessionToken: string | null = null;
  private seq = 0;
  private reconnectAttempts = 0;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Current user info after authentication */
  public userId: string | null = null;
  public userName: string | null = null;

  /** Current session info */
  public sessionId: string | null = null;
  public joinCode: string | null = null;

  /** Event listeners */
  private listeners = new Map<string, Set<EventCallback>>();

  /** Pending requests awaiting response */
  private pendingRequests = new Map<
    number,
    {
      resolve: (response: WSResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * Get current connection status.
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Check if connected and authenticated.
   */
  isConnected(): boolean {
    return this.status === "connected";
  }

  /**
   * Check if already connecting or connected (to prevent duplicate connections).
   */
  isConnectedOrConnecting(): boolean {
    return this.status === "connected" || this.status === "connecting" || this.status === "authenticating";
  }

  /**
   * Connect to the WebSocket server.
   * Token is optional - server can authenticate from HttpOnly cookie during upgrade.
   */
  connect(sessionToken?: string): void {
    if (this.ws) {
      this.disconnect();
    }

    this.sessionToken = sessionToken ?? "";
    this.status = "connecting";
    this.emit("status_change", this.status);

    // Determine WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    console.log(`[ws] Connecting to ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = this.handleOpen.bind(this);
    this.ws.onmessage = this.handleMessage.bind(this);
    this.ws.onclose = this.handleClose.bind(this);
    this.ws.onerror = this.handleError.bind(this);
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    this.stopPing();
    this.cancelReconnect();

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    this.status = "disconnected";
    this.emit("status_change", this.status);

    // Reject all pending requests
    for (const [seq, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error("Disconnected"));
    }
    this.pendingRequests.clear();
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Subscribe to an event.
   */
  on<T = unknown>(event: string, callback: EventCallback<T>): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }

    listeners.add(callback as EventCallback);

    // Return unsubscribe function
    return () => {
      listeners!.delete(callback as EventCallback);
      if (listeners!.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Emit an event to all listeners.
   */
  private emit<T>(event: string, payload: T): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(payload);
        } catch (error) {
          console.error(`[ws] Event handler error for ${event}:`, error);
        }
      }
    }
  }

  // ===========================================================================
  // Connection Handlers
  // ===========================================================================

  private handleOpen(): void {
    console.log("[ws] Connected, authenticating...");

    this.status = "authenticating";
    this.emit("status_change", this.status);

    // Send auth message
    if (this.sessionToken) {
      this.send("auth", { token: this.sessionToken });
    }
  }

  private handleMessage(event: MessageEvent): void {
    let message: WSResponse;

    try {
      message = JSON.parse(event.data);
    } catch {
      console.error("[ws] Invalid JSON received");
      return;
    }

    const { type, payload, reqSeq, success, error } = message;

    // Handle response to pending request
    if (reqSeq !== undefined) {
      const pending = this.pendingRequests.get(reqSeq);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(reqSeq);

        if (success === false) {
          pending.reject(new Error(error ?? "Request failed"));
        } else {
          pending.resolve(message);
        }

        // Still emit the event for general listeners
      }
    }

    // Handle specific message types
    switch (type) {
      case MessageType.AUTH_RESULT:
        this.handleAuthResult(payload as AuthResultPayload & { reconnectedSessionId?: string | null });
        break;

      case MessageType.PONG:
        this.handlePong();
        break;

      case MessageType.ERROR:
        console.error("[ws] Server error:", payload);
        this.emit("error", payload as ErrorPayload);
        break;

      case MessageType.LOBBY_STATE:
        this.emit("lobby_state", payload as LobbyStatePayload);
        break;

      case MessageType.GAME_CREATED:
        const created = payload as { sessionId: string; joinCode: string };
        this.sessionId = created.sessionId;
        this.joinCode = created.joinCode;
        this.emit("game_created", created);
        break;

      case "game_joined":
        const joined = payload as { sessionId: string };
        this.sessionId = joined.sessionId;
        this.emit("game_joined", joined);
        break;

      case "left_game":
        this.sessionId = null;
        this.joinCode = null;
        this.emit("left_game", null);
        break;

      case MessageType.FULL_STATE:
        this.emit("full_state", payload as FullStatePayload);
        break;

      case "state_delta":
        this.emit("state_delta", payload as DeltaStatePayload);
        break;

      case MessageType.EVENTS:
        this.emit("events", payload as EventsPayload);
        break;

      case MessageType.ACTION_RESULT:
        this.emit("action_result", payload as ActionResultPayload);
        break;

      case MessageType.CHAT_RECEIVED:
        this.emit("chat_received", payload as ChatReceivedPayload);
        break;

      case MessageType.PLAYER_JOINED:
        this.emit("player_joined", payload);
        break;

      case MessageType.PLAYER_LEFT:
        this.emit("player_left", payload);
        break;

      case MessageType.PLAYER_DISCONNECTED:
        this.emit("player_disconnected", payload);
        break;

      case MessageType.PLAYER_RECONNECTED:
        this.emit("player_reconnected", payload);
        break;

      case "turn_change":
        this.emit("turn_change", payload as TurnChangeInfo);
        break;

      case "turn_timeout":
        this.emit("turn_timeout", null);
        break;

      case "dm_event":
        this.emit("dm_event", payload);
        break;

      case "dm_command_result":
        this.emit("dm_command_result", payload);
        break;

      case "ready_confirmed":
        this.emit("ready_confirmed", payload);
        break;

      default:
        // Emit generic event for unknown types
        this.emit(type, payload);
    }
  }

  private handleAuthResult(payload: AuthResultPayload & { reconnectedSessionId?: string | null }): void {
    this.userId = payload.userId;
    this.userName = payload.name;
    this.sessionId = payload.reconnectedSessionId ?? null;

    this.status = "connected";
    this.emit("status_change", this.status);
    this.emit("authenticated", { userId: payload.userId, name: payload.name });

    // Reset reconnect state on successful connection
    this.reconnectAttempts = 0;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

    // Start ping interval
    this.startPing();

    console.log(`[ws] Authenticated as ${payload.name} (${payload.userId})`);

    // If reconnected to a session, request full state sync
    if (payload.reconnectedSessionId) {
      console.log(`[ws] Reconnected to session ${payload.reconnectedSessionId}, requesting sync`);
      this.send("request_sync", {});
    }
  }

  private handleClose(event: CloseEvent): void {
    console.log(`[ws] Connection closed: ${event.code} ${event.reason}`);

    this.stopPing();

    const wasConnected = this.status === "connected";
    this.ws = null;

    // Don't reconnect if we intentionally disconnected or auth failed
    if (event.code === 4001 || event.code === 4002) {
      this.status = "disconnected";
      this.emit("status_change", this.status);
      this.emit("auth_failed", event.reason);
      return;
    }

    // Schedule reconnect
    if (this.sessionToken && wasConnected) {
      this.scheduleReconnect();
    } else {
      this.status = "disconnected";
      this.emit("status_change", this.status);
    }
  }

  private handleError(event: Event): void {
    console.error("[ws] WebSocket error:", event);
    this.emit("ws_error", event);
  }

  // ===========================================================================
  // Reconnection
  // ===========================================================================

  private scheduleReconnect(): void {
    this.status = "reconnecting";
    this.emit("status_change", this.status);

    this.reconnectAttempts++;

    console.log(
      `[ws] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimeout = setTimeout(() => {
      if (this.sessionToken) {
        this.connect(this.sessionToken);
      }
    }, this.reconnectDelay);

    // Increase delay with backoff
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_BACKOFF,
      MAX_RECONNECT_DELAY_MS
    );
  }

  private cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  // ===========================================================================
  // Ping/Pong
  // ===========================================================================

  private startPing(): void {
    this.stopPing();

    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send("ping", {});

        // Set timeout for pong response
        this.pongTimeout = setTimeout(() => {
          console.warn("[ws] Pong timeout, reconnecting...");
          this.ws?.close();
        }, PONG_TIMEOUT_MS);
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private handlePong(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  // ===========================================================================
  // Message Sending
  // ===========================================================================

  /**
   * Send a message to the server.
   */
  send(type: string, payload: unknown): number {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[ws] Cannot send, not connected");
      return -1;
    }

    this.seq++;
    const message: WSMessage = {
      type,
      payload,
      seq: this.seq,
      ts: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
    return this.seq;
  }

  /**
   * Send a message and wait for response.
   */
  request<T = unknown>(
    type: string,
    payload: unknown,
    timeoutMs = 10000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const seq = this.send(type, payload);

      if (seq === -1) {
        reject(new Error("Not connected"));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(seq);
        reject(new Error("Request timeout"));
      }, timeoutMs);

      this.pendingRequests.set(seq, {
        resolve: (response: WSResponse) => resolve(response.payload as T),
        reject,
        timeout,
      });
    });
  }

  // ===========================================================================
  // Game Actions
  // ===========================================================================

  /**
   * Create a new game session.
   */
  createGame(
    characterId: string,
    config: {
      maxPlayers?: number;
      mapSeed?: number;
      difficulty?: "easy" | "normal" | "hard";
      turnTimeLimit?: number;
      monsterCount?: number;
      playerMoveRange?: number;
      npcCount?: number;
      npcClasses?: string[];
    } = {}
  ): Promise<{ sessionId: string; joinCode: string }> {
    return this.request("create_game", {
      characterId,
      config: {
        maxPlayers: config.maxPlayers ?? 4,
        difficulty: config.difficulty ?? "normal",
        turnTimeLimit: config.turnTimeLimit ?? 0,
        monsterCount: config.monsterCount ?? 3,
        playerMoveRange: config.playerMoveRange ?? 3,
        ...(config.mapSeed && { mapSeed: config.mapSeed }),
        ...(config.npcCount !== undefined && { npcCount: config.npcCount }),
        ...(config.npcClasses && { npcClasses: config.npcClasses }),
      },
    });
  }

  /**
   * Join an existing game.
   */
  joinGame(
    joinCode: string,
    characterId: string
  ): Promise<{ sessionId: string }> {
    return this.request("join_game", { joinCode, characterId });
  }

  /**
   * Leave the current game.
   */
  leaveGame(): void {
    this.send("leave_game", {});
    this.sessionId = null;
    this.joinCode = null;
  }

  /**
   * Set ready status.
   */
  setReady(ready: boolean): void {
    this.send("ready", { ready });
  }

  /**
   * Send a game action.
   */
  sendAction(action: {
    type: string;
    unitId?: string;
    path?: Array<{ x: number; y: number }>;
    targetId?: string;
    lootId?: string;
  }): Promise<ActionResultPayload> {
    return this.request("action", { action });
  }

  /**
   * Request full state sync.
   */
  requestSync(): void {
    this.send("request_sync", {});
  }

  /**
   * Send a chat message.
   */
  sendChat(message: string, target?: string): void {
    this.send("chat", { message, target });
  }

  /**
   * Send a DM command.
   */
  sendDMCommand(command: unknown): Promise<{ success: boolean }> {
    return this.request("dm_command", { command });
  }

  // ===========================================================================
  // Character Management
  // ===========================================================================

  /**
   * List user's characters.
   */
  listCharacters(): Promise<{
    characters: Array<{ id: string; name: string; class: string; level: number }>;
  }> {
    return this.request("list_characters", {});
  }

  /**
   * Create a new character.
   */
  createCharacter(
    name: string,
    characterClass: "warrior" | "ranger" | "mage" | "rogue"
  ): Promise<{ id: string; name: string; class: string; level: number }> {
    return this.request("create_character", { name, class: characterClass });
  }

  /**
   * Sync a character from local storage to server.
   * Creates if doesn't exist, updates persona if it does.
   */
  syncCharacter(
    character: {
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
    }
  ): Promise<{
    id: string;
    name: string;
    class: string;
    level: number;
    xp: number;
    gold: number;
    silver: number;
  }> {
    return this.request("sync_character", character);
  }
}

// Export singleton instance
export const wsClient = new WSClient();
