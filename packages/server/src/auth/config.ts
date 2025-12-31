/**
 * Authentication Configuration
 *
 * Settings for OIDC authentication with Pocket ID.
 * Mirrors the axonjet implementation pattern but in TypeScript.
 */

import { randomBytes } from "crypto";

export interface AuthConfig {
  /** Enable authentication. When disabled, all routes are public. */
  authEnabled: boolean;

  /** Internal URL for Pocket ID (container-to-container) */
  pocketIdUrl: string;

  /** Public URL for Pocket ID (browser redirects) */
  pocketIdPublicUrl: string;

  /** OIDC Client ID from Pocket ID */
  pocketIdClientId: string;

  /** OIDC Client Secret from Pocket ID */
  pocketIdClientSecret: string;

  /** Secret key for signing session tokens */
  authSecretKey: string;

  /** Session expiration in hours */
  sessionExpireHours: number;

  /** OAuth callback URL (must match what's registered in Pocket ID) */
  authCallbackUrl: string;
}

let _config: AuthConfig | null = null;

/**
 * Get or create auth configuration from environment variables.
 */
export function getAuthConfig(): AuthConfig {
  if (_config !== null) {
    return _config;
  }

  _config = {
    authEnabled: process.env.AUTH_ENABLED === "true",
    pocketIdUrl: process.env.POCKET_ID_URL || "http://localhost:1411",
    pocketIdPublicUrl:
      process.env.POCKET_ID_PUBLIC_URL || "http://localhost:1411",
    pocketIdClientId: process.env.POCKET_ID_CLIENT_ID || "",
    pocketIdClientSecret: process.env.POCKET_ID_CLIENT_SECRET || "",
    authSecretKey: process.env.AUTH_SECRET_KEY || randomBytes(32).toString("hex"),
    sessionExpireHours: parseInt(process.env.SESSION_EXPIRE_HOURS || "168", 10), // 7 days default
    authCallbackUrl:
      process.env.AUTH_CALLBACK_URL || "http://localhost:3000/api/auth/callback",
  };

  return _config;
}

/**
 * Check if auth is properly configured.
 */
export function isAuthConfigured(): boolean {
  const config = getAuthConfig();
  return (
    config.authEnabled &&
    config.pocketIdClientId !== "" &&
    config.pocketIdClientSecret !== ""
  );
}

/**
 * Get OIDC discovery endpoint URL.
 */
export function getOidcDiscoveryUrl(): string {
  const config = getAuthConfig();
  return `${config.pocketIdUrl}/.well-known/openid-configuration`;
}

/**
 * Get public OIDC discovery endpoint URL.
 */
export function getOidcPublicDiscoveryUrl(): string {
  const config = getAuthConfig();
  return `${config.pocketIdPublicUrl}/.well-known/openid-configuration`;
}

/**
 * Reset config (useful for testing).
 */
export function resetAuthConfig(): void {
  _config = null;
}
