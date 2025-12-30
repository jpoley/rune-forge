/**
 * Authentication Middleware
 *
 * Provides request-level authentication context and route protection.
 */

import { getAuthConfig } from "./config.js";
import { getUserFromSession } from "./jwt.js";
import type { UserInfo } from "./types.js";

/**
 * Paths that don't require authentication (even when auth is enabled).
 */
const PUBLIC_PATHS = new Set([
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/logout",
  "/api/auth/logout/sso",
  "/api/health",
  "/api/health/",
]);

/**
 * Path prefixes that don't require authentication.
 */
const PUBLIC_PREFIXES = ["/api/auth/"];

/**
 * Parse cookies from Cookie header.
 */
function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce(
    (acc, cookie) => {
      const [key, value] = cookie.trim().split("=");
      if (key && value) {
        acc[key] = decodeURIComponent(value);
      }
      return acc;
    },
    {} as Record<string, string>
  );
}

/**
 * Check if path is public (doesn't require auth).
 */
function isPublicPath(path: string): boolean {
  // Exact matches
  if (PUBLIC_PATHS.has(path)) {
    return true;
  }

  // Prefix matches
  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract authentication token from request.
 */
function getTokenFromRequest(req: Request): string | null {
  // Check Authorization header first
  const authHeader = req.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check session cookie
  const cookies = parseCookies(req.headers.get("Cookie"));
  return cookies.session || null;
}

/**
 * Authentication context attached to requests.
 */
export interface AuthContext {
  /** Whether auth is enabled for this server */
  authEnabled: boolean;
  /** Current authenticated user, or null */
  user: UserInfo | null;
}

/**
 * Get authentication context for a request.
 */
export async function getAuthContext(req: Request): Promise<AuthContext> {
  const config = getAuthConfig();

  const context: AuthContext = {
    authEnabled: config.authEnabled,
    user: null,
  };

  // Skip auth processing if disabled
  if (!config.authEnabled) {
    return context;
  }

  // Try to get user from token
  const token = getTokenFromRequest(req);
  if (token) {
    context.user = await getUserFromSession(token);
  }

  return context;
}

/**
 * Check if request is authenticated for protected routes.
 *
 * @returns Response if authentication is required but missing, null if ok to proceed.
 */
export async function requireAuth(req: Request): Promise<Response | null> {
  const config = getAuthConfig();
  const url = new URL(req.url);
  const path = url.pathname;

  // Always allow OPTIONS (CORS preflight)
  if (req.method === "OPTIONS") {
    return null;
  }

  // Skip auth if disabled
  if (!config.authEnabled) {
    return null;
  }

  // Skip public paths
  if (isPublicPath(path)) {
    return null;
  }

  // Check authentication
  const context = await getAuthContext(req);

  if (context.user === null) {
    // For API requests, return 401
    if (path.startsWith("/api/")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // For page requests, redirect to login
    const redirectUrl = `/api/auth/login?redirect_uri=${encodeURIComponent(path)}`;
    return new Response(null, {
      status: 302,
      headers: { Location: redirectUrl },
    });
  }

  return null;
}

/**
 * Require DM (Dungeon Master) role for a route.
 *
 * @returns Response if user is not a DM, null if ok to proceed.
 */
export async function requireDM(req: Request): Promise<Response | null> {
  // First check basic auth
  const authResponse = await requireAuth(req);
  if (authResponse) {
    return authResponse;
  }

  const context = await getAuthContext(req);

  // Check if user has DM role (could be in groups or a custom claim)
  // For now, we'll accept any authenticated user
  // TODO: Implement proper DM role checking based on session or database
  if (context.user === null) {
    return new Response(
      JSON.stringify({ error: "DM privileges required" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return null;
}
