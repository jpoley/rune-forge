/**
 * Authentication Routes
 *
 * API routes for the OIDC authentication flow.
 * Handles login, callback, logout, and status endpoints.
 */

import { randomBytes } from "crypto";
import { getAuthConfig, isAuthConfigured } from "./config.js";
import { createSessionToken, getUserFromSession, verifySessionToken } from "./jwt.js";
import { exchangeCode, getAuthorizationUrl, getLogoutUrl, getUserInfo } from "./oidc.js";
import type { AuthStatus, UserInfo } from "./types.js";

/**
 * Cookie options for auth cookies.
 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

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
 * Set cookie in response.
 */
function setCookie(
  headers: Headers,
  name: string,
  value: string,
  maxAge?: number
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_OPTIONS.path}`,
    COOKIE_OPTIONS.httpOnly ? "HttpOnly" : "",
    COOKIE_OPTIONS.secure ? "Secure" : "",
    `SameSite=${COOKIE_OPTIONS.sameSite}`,
    maxAge !== undefined ? `Max-Age=${maxAge}` : "",
  ].filter(Boolean);

  headers.append("Set-Cookie", parts.join("; "));
}

/**
 * Delete cookie in response.
 */
function deleteCookie(headers: Headers, name: string): void {
  headers.append(
    "Set-Cookie",
    `${name}=; Path=${COOKIE_OPTIONS.path}; Max-Age=0`
  );
}

/**
 * JSON response helper.
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Redirect response helper.
 */
function redirectResponse(url: string, headers?: Headers): Response {
  const responseHeaders = headers || new Headers();
  responseHeaders.set("Location", url);
  return new Response(null, { status: 302, headers: responseHeaders });
}

/**
 * Handle auth routes.
 *
 * @returns Response if route was handled, null otherwise.
 */
export async function handleAuthRoutes(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Only handle /api/auth/* routes
  if (!path.startsWith("/api/auth/")) {
    return null;
  }

  const config = getAuthConfig();
  const cookies = parseCookies(req.headers.get("Cookie"));

  // GET /api/auth/status - Get authentication status
  if (path === "/api/auth/status" && method === "GET") {
    const sessionToken = cookies.session;
    let user: UserInfo | null = null;

    if (sessionToken) {
      user = await getUserFromSession(sessionToken);
    }

    const status: AuthStatus = {
      authEnabled: config.authEnabled,
      configured: isAuthConfigured(),
      authenticated: user !== null,
      user,
    };

    return jsonResponse(status);
  }

  // GET /api/auth/login - Initiate login flow
  if (path === "/api/auth/login" && method === "GET") {
    if (!config.authEnabled) {
      return jsonResponse(
        { error: "Authentication is not enabled" },
        503
      );
    }

    if (!isAuthConfigured()) {
      return jsonResponse(
        {
          error:
            "Authentication is not configured. Set POCKET_ID_CLIENT_ID and POCKET_ID_CLIENT_SECRET.",
        },
        503
      );
    }

    // Generate state and nonce for security
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");

    // Get redirect URI from query params
    const redirectUri = url.searchParams.get("redirect_uri");

    // Get authorization URL
    const authUrl = getAuthorizationUrl(state, nonce);

    // Create response with redirect
    const headers = new Headers();

    // Store state and nonce in cookies for verification
    setCookie(headers, "oauth_state", state, 600);
    setCookie(headers, "oauth_nonce", nonce, 600);

    if (redirectUri) {
      setCookie(headers, "oauth_redirect", redirectUri, 600);
    }

    return redirectResponse(authUrl, headers);
  }

  // GET /api/auth/callback - OAuth callback handler
  if (path === "/api/auth/callback" && method === "GET") {
    if (!config.authEnabled) {
      return jsonResponse(
        { error: "Authentication is not enabled" },
        503
      );
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthState = cookies.oauth_state;
    // Note: oauth_nonce would be used for ID token validation if needed
    const oauthRedirect = cookies.oauth_redirect;

    // Verify state matches
    if (!oauthState || state !== oauthState) {
      console.warn("[auth] OAuth state mismatch");
      return jsonResponse({ error: "Invalid state parameter" }, 400);
    }

    if (!code) {
      return jsonResponse({ error: "Missing authorization code" }, 400);
    }

    try {
      // Exchange code for tokens
      const tokens = await exchangeCode(code);

      // Get user info
      const user = await getUserInfo(tokens.accessToken);

      // Create session token
      const sessionToken = await createSessionToken(
        user,
        tokens.accessToken,
        tokens.idToken,
        tokens.refreshToken
      );

      // Redirect to original destination or home
      const redirectUrl = oauthRedirect || "/";

      const headers = new Headers();

      // Set session cookie
      setCookie(
        headers,
        "session",
        sessionToken,
        config.sessionExpireHours * 60 * 60
      );

      // Clear OAuth cookies
      deleteCookie(headers, "oauth_state");
      deleteCookie(headers, "oauth_nonce");
      deleteCookie(headers, "oauth_redirect");

      console.log(`[auth] User logged in: ${user.sub}`);
      return redirectResponse(redirectUrl, headers);
    } catch (error) {
      console.error("[auth] OAuth callback failed:", error);
      return jsonResponse(
        { error: `Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        500
      );
    }
  }

  // GET /api/auth/logout - Logout and clear session
  if (path === "/api/auth/logout" && method === "GET") {
    const headers = new Headers();
    deleteCookie(headers, "session");

    console.log("[auth] User logged out");
    return redirectResponse("/", headers);
  }

  // GET /api/auth/logout/sso - Logout with SSO
  if (path === "/api/auth/logout/sso" && method === "GET") {
    if (!config.authEnabled) {
      const headers = new Headers();
      deleteCookie(headers, "session");
      return redirectResponse("/", headers);
    }

    // Get ID token for logout hint
    const sessionToken = cookies.session;
    let idToken: string | undefined;

    if (sessionToken) {
      const payload = await verifySessionToken(sessionToken);
      if (payload) {
        idToken = payload.idToken;
      }
    }

    // Get logout URL
    const logoutUrl = getLogoutUrl(idToken);

    const headers = new Headers();
    deleteCookie(headers, "session");

    console.log("[auth] User logged out (SSO)");
    return redirectResponse(logoutUrl, headers);
  }

  // GET /api/auth/me - Get current user
  if (path === "/api/auth/me" && method === "GET") {
    const sessionToken = cookies.session;
    let user: UserInfo | null = null;

    if (sessionToken) {
      user = await getUserFromSession(sessionToken);
    }

    return jsonResponse({ user });
  }

  // GET /api/auth/refresh - Refresh session token
  if (path === "/api/auth/refresh" && method === "GET") {
    if (!config.authEnabled) {
      return jsonResponse(
        { error: "Authentication is not enabled" },
        503
      );
    }

    const sessionToken = cookies.session;
    if (!sessionToken) {
      return jsonResponse({ error: "No session to refresh" }, 401);
    }

    const payload = await verifySessionToken(sessionToken);
    if (!payload) {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    // For now, just re-fetch user info and create a new session
    // A full implementation would use refresh_token to get new access_token
    try {
      const user = await getUserInfo(payload.accessToken);
      const newSessionToken = await createSessionToken(
        user,
        payload.accessToken,
        payload.idToken,
        payload.refreshToken
      );

      const headers = new Headers();
      setCookie(
        headers,
        "session",
        newSessionToken,
        config.sessionExpireHours * 60 * 60
      );

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...Object.fromEntries(headers.entries()),
        },
      });
    } catch (error) {
      console.error("[auth] Token refresh failed:", error);
      return jsonResponse({ error: "Failed to refresh session" }, 500);
    }
  }

  return null;
}

/**
 * Extract current user from request.
 * Use this in route handlers to get the authenticated user.
 */
export async function getCurrentUser(req: Request): Promise<UserInfo | null> {
  const cookies = parseCookies(req.headers.get("Cookie"));
  const sessionToken = cookies.session;

  if (!sessionToken) {
    // Check Authorization header
    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      return getUserFromSession(token);
    }
    return null;
  }

  return getUserFromSession(sessionToken);
}
