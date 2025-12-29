/**
 * Rune Forge Server
 * Serves the game client and provides REST API for saves.
 */

import { getDatabase, closeDatabase } from "./database.js";
import type { GameState } from "@rune-forge/simulation";

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_DIR = process.env.CLIENT_DIR || "../client/dist";

// Initialize database
const db = getDatabase(process.env.DB_PATH || "rune-forge.db");

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  closeDatabase();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  closeDatabase();
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

// Main server
const server = Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const start = Date.now();

    let response: Response;

    // API routes
    if (path.startsWith("/api/")) {
      response = await handleApiRequest(req, path);
    } else {
      // Static files
      response = await serveStaticFile(path);
    }

    const duration = Date.now() - start;
    log(`${method} ${path} ${response.status} ${duration}ms`);

    return response;
  },
});

console.log(`🎮 Rune Forge server running at http://localhost:${server.port}`);
console.log(`📁 Serving client from: ${CLIENT_DIR}`);
