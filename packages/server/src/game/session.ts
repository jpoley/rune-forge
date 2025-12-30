/**
 * Game Session Manager
 *
 * Manages game session lifecycle, player joining/leaving, and game state.
 */

import { randomUUID } from "crypto";
import { getDb, type Session, type SessionPlayer, type SessionConfig } from "../db/index.js";
import {
  broadcastToSession,
  sendMessage,
  sendError,
  getConnectionByUserId,
  type TypedWebSocket,
} from "../ws/index.js";
import { createGameState, type GameSessionState } from "./state.js";

/**
 * Active game sessions in memory (for fast access).
 * Database is source of truth, this is a cache.
 */
const activeSessions = new Map<string, GameSessionState>();

/**
 * Get an active session from cache or database.
 */
export function getSession(sessionId: string): GameSessionState | null {
  // Check cache first
  let session = activeSessions.get(sessionId);
  if (session) return session;

  // Load from database
  const dbSession = getDb().sessions.findById(sessionId);
  if (!dbSession || dbSession.status === "ended") return null;

  // Create in-memory state
  session = createGameState(dbSession);
  activeSessions.set(sessionId, session);

  return session;
}

/**
 * Get session by join code.
 */
export function getSessionByJoinCode(joinCode: string): GameSessionState | null {
  const dbSession = getDb().sessions.findByJoinCode(joinCode);
  if (!dbSession) return null;

  return getSession(dbSession.id);
}

/**
 * Create a new game session.
 */
export function createSession(
  dmUserId: string,
  config: Partial<SessionConfig>
): GameSessionState {
  const db = getDb();

  // Check if user is already in a session
  const existingSession = db.sessions.findUserActiveSession(dmUserId);
  if (existingSession) {
    throw new Error("ALREADY_IN_SESSION");
  }

  const sessionId = randomUUID();
  const dbSession = db.sessions.create(sessionId, dmUserId, config);

  const session = createGameState(dbSession);
  activeSessions.set(sessionId, session);

  console.log(`[game] Session created: ${sessionId} (code: ${dbSession.joinCode})`);

  return session;
}

/**
 * Join an existing session.
 */
export function joinSession(
  sessionId: string,
  userId: string,
  characterId: string
): SessionPlayer {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  if (session.status !== "lobby") {
    throw new Error("GAME_ALREADY_STARTED");
  }

  // Check if session is full
  const playerCount = db.sessions.getPlayerCount(sessionId);
  if (playerCount >= session.config.maxPlayers) {
    throw new Error("SESSION_FULL");
  }

  // Check if user is already in another session
  const existingSession = db.sessions.findUserActiveSession(userId);
  if (existingSession && existingSession.id !== sessionId) {
    throw new Error("ALREADY_IN_SESSION");
  }

  // Check if already in this session
  if (db.sessions.isPlayerInSession(sessionId, userId)) {
    return db.sessions.getPlayer(sessionId, userId)!;
  }

  // Verify character belongs to user
  if (!db.characters.belongsToUser(characterId, userId)) {
    throw new Error("CHARACTER_NOT_FOUND");
  }

  // Add player to session
  const player = db.sessions.addPlayer(sessionId, userId, characterId);

  console.log(`[game] Player ${userId} joined session ${sessionId}`);

  return player;
}

/**
 * Leave a session.
 */
export function leaveSession(sessionId: string, userId: string): void {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) return;

  // Remove player
  db.sessions.removePlayer(sessionId, userId);

  console.log(`[game] Player ${userId} left session ${sessionId}`);

  // If DM leaves, end the session
  if (session.dmUserId === userId) {
    endSession(sessionId, "dm_ended");
    return;
  }

  // Notify other players
  broadcastToSession(sessionId, "player_left", {
    userId,
    reason: "left",
  });

  // If no players left, clean up session
  const remainingPlayers = db.sessions.getPlayerCount(sessionId);
  if (remainingPlayers === 0 && session.status === "lobby") {
    cleanupSession(sessionId);
  }
}

/**
 * Set player ready status.
 */
export function setPlayerReady(
  sessionId: string,
  userId: string,
  ready: boolean
): void {
  const db = getDb();

  db.sessions.updatePlayerReady(sessionId, userId, ready);

  // Notify all players
  broadcastToSession(sessionId, "player_ready", {
    userId,
    ready,
  });
}

/**
 * Update player connection status.
 */
export function updatePlayerConnection(
  sessionId: string,
  userId: string,
  connected: boolean
): void {
  const db = getDb();

  db.sessions.updatePlayerStatus(
    sessionId,
    userId,
    connected ? "connected" : "disconnected"
  );

  if (!connected) {
    broadcastToSession(sessionId, "player_disconnected", { userId });
  } else {
    broadcastToSession(sessionId, "player_reconnected", { userId });
  }
}

/**
 * Start a game session (DM only).
 */
export function startGame(sessionId: string, dmUserId: string): void {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  if (session.dmUserId !== dmUserId) {
    throw new Error("DM_REQUIRED");
  }

  if (session.status !== "lobby") {
    throw new Error("GAME_ALREADY_STARTED");
  }

  // Check minimum players (at least 1 player besides DM)
  const players = db.sessions.getPlayers(sessionId);
  if (players.length === 0) {
    throw new Error("NOT_ENOUGH_PLAYERS");
  }

  // Update status
  db.sessions.updateStatus(sessionId, "playing");
  session.status = "playing";
  session.startedAt = Date.now();

  // Initialize game state will be done in executor.ts
  console.log(`[game] Session ${sessionId} started`);

  // Notify all players
  broadcastToSession(sessionId, "game_started", {
    sessionId,
  });
}

/**
 * Pause a game (DM only).
 */
export function pauseGame(sessionId: string, dmUserId: string): void {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) throw new Error("SESSION_NOT_FOUND");
  if (session.dmUserId !== dmUserId) throw new Error("DM_REQUIRED");
  if (session.status !== "playing") throw new Error("GAME_NOT_STARTED");

  db.sessions.updateStatus(sessionId, "paused");
  session.status = "paused";

  broadcastToSession(sessionId, "game_paused", {});
}

/**
 * Resume a paused game (DM only).
 */
export function resumeGame(sessionId: string, dmUserId: string): void {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) throw new Error("SESSION_NOT_FOUND");
  if (session.dmUserId !== dmUserId) throw new Error("DM_REQUIRED");
  if (session.status !== "paused") throw new Error("GAME_NOT_PAUSED");

  db.sessions.updateStatus(sessionId, "playing");
  session.status = "playing";

  broadcastToSession(sessionId, "game_resumed", {});
}

/**
 * End a game session.
 */
export function endSession(
  sessionId: string,
  reason: "victory" | "defeat" | "dm_ended" = "dm_ended"
): void {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) return;

  db.sessions.updateStatus(sessionId, "ended");
  session.status = "ended";
  session.endedAt = Date.now();

  // Broadcast to all players
  broadcastToSession(sessionId, "game_ended", {
    result: reason,
    rewards: [], // TODO: Calculate rewards
  });

  // Clean up after a delay
  setTimeout(() => cleanupSession(sessionId), 30000);
}

/**
 * Clean up session from memory.
 */
function cleanupSession(sessionId: string): void {
  activeSessions.delete(sessionId);
  console.log(`[game] Session ${sessionId} cleaned up`);
}

/**
 * Kick a player from session (DM only).
 */
export function kickPlayer(
  sessionId: string,
  dmUserId: string,
  targetUserId: string
): void {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) throw new Error("SESSION_NOT_FOUND");
  if (session.dmUserId !== dmUserId) throw new Error("DM_REQUIRED");
  if (session.dmUserId === targetUserId) throw new Error("CANNOT_KICK_DM");

  // Remove from session
  db.sessions.removePlayer(sessionId, targetUserId);

  // Notify kicked player
  const kickedWs = getConnectionByUserId(targetUserId);
  if (kickedWs) {
    sendMessage(kickedWs, "kicked", { sessionId });
    kickedWs.data.sessionId = null;
  }

  // Notify other players
  broadcastToSession(sessionId, "player_left", {
    userId: targetUserId,
    reason: "kicked",
  });
}

/**
 * Get lobby state for a session.
 */
export function getLobbyState(sessionId: string): {
  sessionId: string;
  joinCode: string;
  config: SessionConfig;
  players: Array<{
    userId: string;
    characterName: string;
    characterClass: string;
    ready: boolean;
    isDM: boolean;
    connected: boolean;
  }>;
  status: string;
} | null {
  const db = getDb();
  const session = getSession(sessionId);

  if (!session) return null;

  const dbPlayers = db.sessions.getPlayers(sessionId);
  const players = dbPlayers.map((p) => {
    const character = db.characters.findById(p.characterId);
    return {
      userId: p.userId,
      characterName: character?.name ?? "Unknown",
      characterClass: character?.class ?? "warrior",
      ready: p.isReady,
      isDM: p.userId === session.dmUserId,
      connected: p.status === "connected",
    };
  });

  return {
    sessionId: session.id,
    joinCode: session.joinCode,
    config: session.config,
    players,
    status: session.status,
  };
}

/**
 * Get all active sessions (for debugging/admin).
 */
export function getActiveSessions(): string[] {
  return Array.from(activeSessions.keys());
}
