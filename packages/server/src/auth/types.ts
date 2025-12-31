/**
 * Authentication Types
 *
 * Type definitions for OIDC authentication flow.
 */

/**
 * User information from OIDC provider.
 */
export interface UserInfo {
  /** Subject (unique user ID) */
  sub: string;
  email?: string | undefined;
  name?: string | undefined;
  preferredUsername?: string | undefined;
  picture?: string | undefined;
  groups?: string[] | undefined;
}

/**
 * OIDC provider configuration from discovery endpoint.
 */
export interface OIDCConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  jwksUri: string;
  endSessionEndpoint?: string;
}

/**
 * OAuth token response.
 */
export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
}

/**
 * Session payload stored in JWT.
 */
export interface SessionPayload {
  sub: string;
  email?: string | undefined;
  name?: string | undefined;
  picture?: string | undefined;
  exp: number;
  iat: number;
  type: "session";
  accessToken: string;
  idToken?: string | undefined;
  refreshToken?: string | undefined;
}

/**
 * Auth status response.
 */
export interface AuthStatus {
  authEnabled: boolean;
  configured: boolean;
  authenticated: boolean;
  user: UserInfo | null;
}

/**
 * OAuth state stored in cookies during login flow.
 */
export interface OAuthState {
  state: string;
  nonce: string;
  redirectUri?: string;
}
