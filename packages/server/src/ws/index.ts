/**
 * WebSocket Module
 *
 * WebSocket server implementation with authentication and message routing.
 */

// Types
export type { TypedWebSocket, WSConnectionData, PlayerConnectionStatus } from "./types.js";

// Handler functions
export {
  handleOpen,
  handleMessage,
  handleClose,
  registerHandler,
  sendMessage,
  sendError,
  broadcastToSession,
  getConnectionByUserId,
  getSessionConnections,
  getConnectionCount,
  getAuthenticatedCount,
  getPlayerStatus,
  isPlayerInGracePeriod,
} from "./handler.js";
