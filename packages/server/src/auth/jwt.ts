/**
 * JWT Session Management
 *
 * JWT-based session tokens for authenticated users.
 * Uses Bun's built-in crypto for HMAC signing (no external dependency).
 */

import { getAuthConfig } from "./config.js";
import type { SessionPayload, UserInfo } from "./types.js";

const ALGORITHM = "HS256";

/**
 * Base64URL encode a buffer.
 */
function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Base64URL decode a string.
 */
function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Create HMAC-SHA256 signature.
 */
async function sign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64UrlEncode(signature);
}

/**
 * Verify HMAC-SHA256 signature.
 */
async function verify(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expectedSignature = await sign(data, secret);
  return signature === expectedSignature;
}

/**
 * Create a session token for an authenticated user.
 */
export async function createSessionToken(
  user: UserInfo,
  accessToken: string,
  idToken?: string,
  refreshToken?: string
): Promise<string> {
  const config = getAuthConfig();

  const now = Math.floor(Date.now() / 1000);
  const expireSeconds = config.sessionExpireHours * 60 * 60;

  const payload: SessionPayload = {
    sub: user.sub,
    email: user.email,
    name: user.name,
    picture: user.picture,
    exp: now + expireSeconds,
    iat: now,
    type: "session",
    accessToken,
    idToken,
    refreshToken,
  };

  // Create JWT header
  const header = {
    alg: ALGORITHM,
    typ: "JWT",
  };

  const encoder = new TextEncoder();
  const headerEncoded = base64UrlEncode(
    encoder.encode(JSON.stringify(header))
  );
  const payloadEncoded = base64UrlEncode(
    encoder.encode(JSON.stringify(payload))
  );

  const data = `${headerEncoded}.${payloadEncoded}`;
  const signature = await sign(data, config.authSecretKey);

  return `${data}.${signature}`;
}

/**
 * Verify and decode a session token.
 *
 * @returns Decoded claims or null if invalid.
 */
export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  const config = getAuthConfig();

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerEncoded, payloadEncoded, signature] = parts;

  // Verify signature
  const data = `${headerEncoded}.${payloadEncoded}`;
  const isValid = await verify(data!, signature!, config.authSecretKey);

  if (!isValid) {
    return null;
  }

  // Decode payload
  try {
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadEncoded!));
    const payload = JSON.parse(payloadJson) as SessionPayload;

    // Verify it's a session token
    if (payload.type !== "session") {
      return null;
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract user info from session token.
 */
export async function getUserFromSession(token: string): Promise<UserInfo | null> {
  const payload = await verifySessionToken(token);
  if (payload === null) {
    return null;
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
}
