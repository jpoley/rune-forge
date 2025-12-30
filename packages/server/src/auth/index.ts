/**
 * Authentication Module
 *
 * Complete OIDC authentication implementation for Pocket ID.
 *
 * Usage:
 *   import { handleAuthRoutes, getCurrentUser, requireAuth } from "./auth/index.js";
 *
 *   // In your request handler:
 *   const authResponse = await handleAuthRoutes(req);
 *   if (authResponse) return authResponse;
 *
 *   // For protected routes:
 *   const authRequired = await requireAuth(req);
 *   if (authRequired) return authRequired;
 *
 *   // Get current user:
 *   const user = await getCurrentUser(req);
 */

// Configuration
export { getAuthConfig, isAuthConfigured, resetAuthConfig } from "./config.js";

// Types
export type {
  AuthStatus,
  OAuthState,
  OIDCConfig,
  SessionPayload,
  TokenResponse,
  UserInfo,
} from "./types.js";

// JWT utilities
export {
  createSessionToken,
  getUserFromSession,
  verifySessionToken,
} from "./jwt.js";

// OIDC client
export {
  exchangeCode,
  getAuthorizationUrl,
  getJWKS,
  getLogoutUrl,
  getOIDCConfig,
  getUserInfo,
  resetOIDCConfig,
} from "./oidc.js";

// Route handlers
export { getCurrentUser, handleAuthRoutes } from "./routes.js";

// Middleware
export {
  getAuthContext,
  requireAuth,
  requireDM,
  type AuthContext,
} from "./middleware.js";
