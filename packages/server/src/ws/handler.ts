/**
 * WebSocket Handler
 *
 * Manages WebSocket connections, authentication, and message routing.
 */

import { randomUUID } from "crypto";
import { getUserFromSession } from "../auth/jwt.js";
import type { TypedWebSocket, RateLimitBucket, PlayerConnectionStatus } from "./types.js";

/** Auth timeout in milliseconds (5 seconds) */
const AUTH_TIMEOUT_MS = 5000;

/** Grace period for disconnection before removal (30 seconds) */
const DISCONNECT_GRACE_PERIOD_MS = 30000;

/** Rate limit: max actions per minute */
const ACTION_RATE_LIMIT = 30;

/** Rate limit: max chat messages per minute */
const CHAT_RATE_LIMIT = 20;

/** Rate limit window in milliseconds */
const RATE_LIMIT_WINDOW_MS = 60000;

/**
 * Active connections indexed by connection ID.
 */
const connections = new Map<string, TypedWebSocket>();

/**
 * User ID to connection ID mapping (for user lookup).
 */
const userConnections = new Map<string, string>();

/**
 * Rate limit buckets per connection.
 */
const rateLimits = new Map<string, Map<string, RateLimitBucket>>();

/**
 * Disconnected player info for grace period tracking.
 */
interface DisconnectedPlayer {
  userId: string;
  sessionId: string;
  disconnectedAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Disconnected players awaiting reconnection (keyed by userId).
 */
const disconnectedPlayers = new Map<string, DisconnectedPlayer>();

/**
 * Message handlers by type.
 */
type MessageHandler = (
  ws: TypedWebSocket,
  payload: unknown,
  seq: number
) => Promise<void> | void;

const messageHandlers = new Map<string, MessageHandler>();

/**
 * Register a message handler.
 */
export function registerHandler(type: string, handler: MessageHandler): void {
  messageHandlers.set(type, handler);
}

/**
 * Get a connection by user ID.
 */
export function getConnectionByUserId(userId: string): TypedWebSocket | undefined {
  const connId = userConnections.get(userId);
  if (!connId) return undefined;
  return connections.get(connId);
}

/**
 * Get all connections in a session.
 */
export function getSessionConnections(sessionId: string): TypedWebSocket[] {
  const result: TypedWebSocket[] = [];
  for (const ws of connections.values()) {
    if (ws.data.sessionId === sessionId) {
      result.push(ws);
    }
  }
  return result;
}

/**
 * Broadcast a message to all connections in a session.
 */
export function broadcastToSession(
  sessionId: string,
  type: string,
  payload: unknown,
  excludeConnectionId?: string
): void {
  const conns = getSessionConnections(sessionId);
  for (const ws of conns) {
    if (excludeConnectionId && ws.data.id === excludeConnectionId) continue;
    sendMessage(ws, type, payload);
  }
}

/**
 * Send a message to a WebSocket.
 */
export function sendMessage(
  ws: TypedWebSocket,
  type: string,
  payload: unknown,
  reqSeq?: number,
  success = true,
  error?: string
): void {
  ws.data.seq += 1;

  const message = {
    type,
    payload,
    seq: ws.data.seq,
    ts: Date.now(),
    ...(reqSeq !== undefined && { reqSeq }),
    success,
    ...(error && { error }),
  };

  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    console.error(`[ws] Failed to send message to ${ws.data.id}:`, err);
  }
}

/**
 * Send an error response.
 */
export function sendError(
  ws: TypedWebSocket,
  code: string,
  message: string,
  reqSeq?: number
): void {
  sendMessage(ws, "error", { code, message }, reqSeq, false, message);
}

/**
 * Check rate limit for a connection.
 *
 * @returns true if within limit, false if rate limited
 */
function checkRateLimit(
  connectionId: string,
  category: string,
  limit: number
): boolean {
  let connLimits = rateLimits.get(connectionId);
  if (!connLimits) {
    connLimits = new Map();
    rateLimits.set(connectionId, connLimits);
  }

  let bucket = connLimits.get(category);
  const now = Date.now();

  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    // Start new window
    bucket = { count: 1, windowStart: now };
    connLimits.set(category, bucket);
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count += 1;
  return true;
}

/**
 * Handle new WebSocket connection.
 */
export function handleOpen(ws: TypedWebSocket): void {
  const connectionId = randomUUID();

  ws.data = {
    id: connectionId,
    user: null,
    authDeadline: Date.now() + AUTH_TIMEOUT_MS,
    sessionId: null,
    lastActivity: Date.now(),
    seq: 0,
    status: "connected",
  };

  connections.set(connectionId, ws);

  console.log(`[ws] Connection opened: ${connectionId}`);

  // Set auth timeout
  setTimeout(() => {
    if (ws.data.user === null && connections.has(connectionId)) {
      console.log(`[ws] Auth timeout for ${connectionId}`);
      sendError(ws, "AUTH_REQUIRED", "Authentication timeout");
      ws.close(4001, "Authentication timeout");
    }
  }, AUTH_TIMEOUT_MS);
}

/**
 * Handle incoming WebSocket message.
 */
export async function handleMessage(
  ws: TypedWebSocket,
  rawMessage: string | Buffer
): Promise<void> {
  ws.data.lastActivity = Date.now();

  let message: {
    type?: string;
    payload?: unknown;
    seq?: number;
    ts?: number;
  };

  try {
    const text =
      typeof rawMessage === "string"
        ? rawMessage
        : rawMessage.toString("utf-8");
    message = JSON.parse(text);
  } catch {
    sendError(ws, "INVALID_MESSAGE", "Invalid JSON");
    return;
  }

  const { type, payload, seq } = message;

  if (typeof type !== "string" || typeof seq !== "number") {
    sendError(ws, "INVALID_MESSAGE", "Missing type or seq");
    return;
  }

  // Handle auth message specially (before user is set)
  if (type === "auth") {
    await handleAuth(ws, payload, seq);
    return;
  }

  // All other messages require authentication
  if (ws.data.user === null) {
    sendError(ws, "AUTH_REQUIRED", "Authentication required", seq);
    return;
  }

  // Handle ping
  if (type === "ping") {
    sendMessage(ws, "pong", {}, seq);
    return;
  }

  // Check rate limits for certain message types
  if (type === "action") {
    if (!checkRateLimit(ws.data.id, "action", ACTION_RATE_LIMIT)) {
      sendError(ws, "RATE_LIMITED", "Too many actions", seq);
      return;
    }
  }

  if (type === "chat") {
    if (!checkRateLimit(ws.data.id, "chat", CHAT_RATE_LIMIT)) {
      sendError(ws, "RATE_LIMITED", "Too many chat messages", seq);
      return;
    }
  }

  // Route to registered handler
  const handler = messageHandlers.get(type);
  if (handler) {
    try {
      await handler(ws, payload, seq);
    } catch (err) {
      console.error(`[ws] Handler error for ${type}:`, err);
      sendError(ws, "INTERNAL_ERROR", "Internal server error", seq);
    }
  } else {
    sendError(ws, "INVALID_MESSAGE", `Unknown message type: ${type}`, seq);
  }
}

/**
 * Handle authentication message.
 */
async function handleAuth(
  ws: TypedWebSocket,
  payload: unknown,
  seq: number
): Promise<void> {
  if (ws.data.user !== null) {
    sendError(ws, "AUTH_FAILED", "Already authenticated", seq);
    return;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("token" in payload) ||
    typeof (payload as { token: unknown }).token !== "string"
  ) {
    sendError(ws, "AUTH_FAILED", "Invalid auth payload", seq);
    return;
  }

  const token = (payload as { token: string }).token;

  try {
    const user = await getUserFromSession(token);

    if (!user) {
      sendError(ws, "AUTH_FAILED", "Invalid or expired token", seq);
      ws.close(4002, "Authentication failed");
      return;
    }

    // Set user on connection
    ws.data.user = user;
    ws.data.status = "connected";

    // Track user connection
    const existingConnId = userConnections.get(user.sub);
    if (existingConnId && existingConnId !== ws.data.id) {
      // User reconnecting - close old connection
      const oldWs = connections.get(existingConnId);
      if (oldWs) {
        console.log(`[ws] Closing old connection for user ${user.sub}`);
        oldWs.close(4003, "Replaced by new connection");
      }
    }
    userConnections.set(user.sub, ws.data.id);

    // Check if this is a reconnection within grace period
    const disconnected = disconnectedPlayers.get(user.sub);
    let reconnectedSessionId: string | null = null;

    if (disconnected) {
      // Clear the grace period timeout
      clearTimeout(disconnected.timeoutId);
      disconnectedPlayers.delete(user.sub);

      // Restore session
      ws.data.sessionId = disconnected.sessionId;
      reconnectedSessionId = disconnected.sessionId;

      console.log(`[ws] User reconnected: ${user.sub} to session ${disconnected.sessionId}`);

      // Notify session of reconnection
      broadcastToSession(disconnected.sessionId, "player_reconnected", {
        userId: user.sub,
        name: user.name,
      }, ws.data.id);
    } else {
      console.log(`[ws] User authenticated: ${user.sub} (${user.name})`);
    }

    sendMessage(
      ws,
      "auth_result",
      {
        userId: user.sub,
        name: user.name,
        reconnectedSessionId,
      },
      seq
    );
  } catch (err) {
    console.error(`[ws] Auth error:`, err);
    sendError(ws, "AUTH_FAILED", "Authentication error", seq);
    ws.close(4002, "Authentication failed");
  }
}

/**
 * Handle WebSocket close.
 */
export function handleClose(
  ws: TypedWebSocket,
  code: number,
  reason: string
): void {
  const connectionId = ws.data.id;
  const userId = ws.data.user?.sub;
  const sessionId = ws.data.sessionId;

  console.log(`[ws] Connection closed: ${connectionId} (${code}: ${reason})`);

  // Clean up connection mappings
  connections.delete(connectionId);
  rateLimits.delete(connectionId);

  if (userId) {
    const currentConnId = userConnections.get(userId);
    if (currentConnId === connectionId) {
      userConnections.delete(userId);
    }

    // If player was in a session, start grace period
    if (sessionId) {
      // Notify session of disconnect (status change)
      broadcastToSession(sessionId, "player_disconnected", {
        userId,
        name: ws.data.user?.name,
        gracePeriodMs: DISCONNECT_GRACE_PERIOD_MS,
      });

      // Start grace period timer
      const timeoutId = setTimeout(() => {
        handleDisconnectTimeout(userId, sessionId);
      }, DISCONNECT_GRACE_PERIOD_MS);

      // Track disconnected player
      disconnectedPlayers.set(userId, {
        userId,
        sessionId,
        disconnectedAt: Date.now(),
        timeoutId,
      });

      console.log(`[ws] Started ${DISCONNECT_GRACE_PERIOD_MS / 1000}s grace period for ${userId} in session ${sessionId}`);
    }
  }
}

/**
 * Handle disconnect timeout - remove player from session.
 */
function handleDisconnectTimeout(userId: string, sessionId: string): void {
  const disconnected = disconnectedPlayers.get(userId);

  // Only proceed if the player is still in the disconnected state
  if (!disconnected || disconnected.sessionId !== sessionId) {
    return;
  }

  console.log(`[ws] Grace period expired for ${userId} in session ${sessionId}`);

  // Clean up
  disconnectedPlayers.delete(userId);

  // Notify session that player has left
  broadcastToSession(sessionId, "player_left", {
    userId,
    reason: "disconnect_timeout",
  });

  // Actually remove player from session via session module
  try {
    const { leaveSession } = require("../game/session.js");
    leaveSession(sessionId, userId);
  } catch (err) {
    console.error(`[ws] Error removing player from session:`, err);
  }
}

/**
 * Get player connection status.
 */
export function getPlayerStatus(userId: string): PlayerConnectionStatus {
  const connId = userConnections.get(userId);
  if (connId) {
    const ws = connections.get(connId);
    if (ws) {
      return ws.data.status;
    }
  }

  if (disconnectedPlayers.has(userId)) {
    return "disconnected";
  }

  return "disconnected";
}

/**
 * Check if a player is in grace period.
 */
export function isPlayerInGracePeriod(userId: string): boolean {
  return disconnectedPlayers.has(userId);
}

/**
 * Get connection count.
 */
export function getConnectionCount(): number {
  return connections.size;
}

/**
 * Get authenticated connection count.
 */
export function getAuthenticatedCount(): number {
  let count = 0;
  for (const ws of connections.values()) {
    if (ws.data.user !== null) {
      count += 1;
    }
  }
  return count;
}
