/**
 * Rune Forge Server
 * Serves the game client and provides REST API for saves.
 * Includes OIDC authentication with Pocket ID.
 * Supports multiplayer via WebSockets.
 */

import { initDatabase, closeDb, getDb } from "./db/index.js";
import { handleAuthRoutes, getAuthConfig } from "./auth/index.js";
import {
  handleOpen,
  handleMessage,
  handleClose,
  getConnectionCount,
  getAuthenticatedCount,
  type WSConnectionData,
} from "./ws/index.js";
import { registerGameHandlers } from "./game/index.js";
import type { GameState } from "@rune-forge/simulation";

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_DIR = process.env.CLIENT_DIR || "../client/dist";

// Initialize database (uses .data/rune-forge.db by default)
const database = initDatabase();

// Register game message handlers
registerGameHandlers();

// Legacy database interface for saves API (backwards compatibility)
const db = {
  save: (slot: number, name: string, gameState: GameState) => {
    const now = Math.floor(Date.now() / 1000);
    database.db.run(
      `INSERT OR REPLACE INTO saves (slot, name, timestamp, version, game_state)
       VALUES (?, ?, ?, ?, ?)`,
      [slot, name, now, 1, JSON.stringify(gameState)]
    );
    return { slot, name, timestamp: now, version: 1 };
  },
  load: (slot: number) => {
    const row = database.db
      .query<{ slot: number; name: string; timestamp: number; version: number; game_state: string }, [number]>(
        "SELECT * FROM saves WHERE slot = ?"
      )
      .get(slot);
    if (!row) return null;
    return {
      slot: row.slot,
      name: row.name,
      timestamp: row.timestamp,
      version: row.version,
      gameState: JSON.parse(row.game_state) as GameState,
    };
  },
  delete: (slot: number) => {
    const result = database.db.run("DELETE FROM saves WHERE slot = ?", [slot]);
    return result.changes > 0;
  },
  listSaves: () => {
    const saves: (null | { slot: number; name: string; timestamp: number; version: number })[] =
      new Array(10).fill(null);
    const rows = database.db
      .query<{ slot: number; name: string; timestamp: number; version: number }, []>(
        "SELECT slot, name, timestamp, version FROM saves ORDER BY slot"
      )
      .all();
    for (const row of rows) {
      saves[row.slot - 1] = row;
    }
    return saves;
  },
};

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  closeDb();
  process.exit(0);
});

// CORS headers for development
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// JSON response helper
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// Error response helper
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// API route handlers
async function handleApiRequest(req: Request, path: string): Promise<Response> {
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // GET /api/saves - List all saves
  if (path === "/api/saves" && method === "GET") {
    try {
      const saves = db.listSaves();
      return jsonResponse({ saves });
    } catch (error) {
      console.error("Error listing saves:", error);
      return errorResponse("Failed to list saves", 500);
    }
  }

  // GET /api/saves/:slot - Load a save
  const loadMatch = path.match(/^\/api\/saves\/(\d+)$/);
  if (loadMatch && method === "GET") {
    try {
      const slot = parseInt(loadMatch[1]!, 10);
      const save = db.load(slot);

      if (!save) {
        return errorResponse("Save not found", 404);
      }

      return jsonResponse({ save });
    } catch (error) {
      console.error("Error loading save:", error);
      return errorResponse("Failed to load save", 500);
    }
  }

  // POST /api/saves/:slot - Create/update a save
  if (loadMatch && method === "POST") {
    try {
      const slot = parseInt(loadMatch[1]!, 10);
      const body = await req.json() as { name: string; gameState: GameState };

      if (!body.name || !body.gameState) {
        return errorResponse("Missing name or gameState in request body");
      }

      const metadata = db.save(slot, body.name, body.gameState);
      return jsonResponse({ save: metadata }, 201);
    } catch (error) {
      console.error("Error saving game:", error);
      return errorResponse("Failed to save game", 500);
    }
  }

  // DELETE /api/saves/:slot - Delete a save
  if (loadMatch && method === "DELETE") {
    try {
      const slot = parseInt(loadMatch[1]!, 10);
      const deleted = db.delete(slot);

      if (!deleted) {
        return errorResponse("Save not found", 404);
      }

      return jsonResponse({ success: true });
    } catch (error) {
      console.error("Error deleting save:", error);
      return errorResponse("Failed to delete save", 500);
    }
  }

  // GET /api/health - Health check
  if (path === "/api/health" && method === "GET") {
    return jsonResponse({
      status: "ok",
      version: "0.1.0",
      timestamp: Date.now(),
      connections: getConnectionCount(),
      authenticated: getAuthenticatedCount(),
    });
  }

  return errorResponse("Not found", 404);
}

// Static file serving
async function serveStaticFile(path: string): Promise<Response> {
  // Default to index.html for SPA routing
  let filePath = path === "/" ? "/index.html" : path;

  try {
    const file = Bun.file(`${CLIENT_DIR}${filePath}`);

    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "Content-Type": getContentType(filePath),
        },
      });
    }

    // SPA fallback - serve index.html for unknown routes
    const indexFile = Bun.file(`${CLIENT_DIR}/index.html`);
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function getContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    mjs: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
  };
  return types[ext || ""] || "application/octet-stream";
}

// Request logging
function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Main server with WebSocket support
const server = Bun.serve<WSConnectionData>({
  port: PORT,

  async fetch(req: Request, server): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const start = Date.now();

    // Handle WebSocket upgrade at /ws
    if (path === "/ws") {
      const upgraded = server.upgrade(req, {
        data: {
          id: "",
          user: null,
          authDeadline: 0,
          sessionId: null,
          lastActivity: Date.now(),
          seq: 0,
          status: "connected" as const,
        },
      });

      if (upgraded) {
        log(`${method} ${path} 101 WebSocket upgrade`);
        return undefined as unknown as Response;
      }

      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    let response: Response;

    // Handle auth routes first (login, callback, logout, etc.)
    const authResponse = await handleAuthRoutes(req);
    if (authResponse) {
      response = authResponse;
    }
    // API routes
    else if (path.startsWith("/api/")) {
      response = await handleApiRequest(req, path);
    } else {
      // Static files
      response = await serveStaticFile(path);
    }

    const duration = Date.now() - start;
    log(`${method} ${path} ${response.status} ${duration}ms`);

    return response;
  },

  websocket: {
    open: handleOpen,
    message: handleMessage,
    close: handleClose,
  },
});

// Log server startup info
const config = getAuthConfig();
console.log(`🎮 Rune Forge server running at http://localhost:${server.port}`);
console.log(`📁 Serving client from: ${CLIENT_DIR}`);
console.log(`🔌 WebSocket endpoint: ws://localhost:${server.port}/ws`);
console.log(`🔐 Authentication: ${config.authEnabled ? "enabled" : "disabled"}`);
if (config.authEnabled) {
  console.log(`   Pocket ID: ${config.pocketIdPublicUrl}`);
}
