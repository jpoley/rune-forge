/**
 * WebSocket Server Types
 *
 * Internal types for WebSocket connection management.
 */

import type { ServerWebSocket } from "bun";
import type { UserInfo } from "../auth/types.js";

/**
 * Player connection status.
 */
export type PlayerConnectionStatus = "connected" | "disconnected" | "spectating";

/**
 * Data attached to each WebSocket connection.
 */
export interface WSConnectionData {
  /** Unique connection ID */
  id: string;
  /** Authenticated user (null until auth completes) */
  user: UserInfo | null;
  /** Authentication deadline (ms since epoch) */
  authDeadline: number;
  /** Current session ID (null if not in a game) */
  sessionId: string | null;
  /** Last activity timestamp */
  lastActivity: number;
  /** Sequence counter for outgoing messages */
  seq: number;
  /** Connection status */
  status: PlayerConnectionStatus;
}

/**
 * Typed WebSocket with connection data.
 */
export type TypedWebSocket = ServerWebSocket<WSConnectionData>;

/**
 * Connection state for tracking.
 */
export interface ConnectionState {
  /** WebSocket instance */
  ws: TypedWebSocket;
  /** Connection data */
  data: WSConnectionData;
}

/**
 * Connection manager events.
 */
export interface ConnectionEvents {
  onConnect: (ws: TypedWebSocket) => void;
  onMessage: (ws: TypedWebSocket, message: string | Buffer) => void;
  onClose: (ws: TypedWebSocket, code: number, reason: string) => void;
  onError: (ws: TypedWebSocket, error: Error) => void;
}

/**
 * Rate limit configuration.
 */
export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window duration in ms */
  windowMs: number;
}

/**
 * Rate limit bucket for a connection.
 */
export interface RateLimitBucket {
  /** Request count in current window */
  count: number;
  /** Window start time */
  windowStart: number;
}
