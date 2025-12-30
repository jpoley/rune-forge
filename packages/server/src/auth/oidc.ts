/**
 * OIDC Client
 *
 * OpenID Connect client for Pocket ID authentication.
 * Handles the full OAuth2/OIDC flow.
 */

import { getAuthConfig, getOidcDiscoveryUrl } from "./config.js";
import type { OIDCConfig, TokenResponse, UserInfo } from "./types.js";

let _oidcConfig: OIDCConfig | null = null;
let _jwks: { keys: JsonWebKey[] } | null = null;
let _jwksFetchedAt: number | null = null;

const JWKS_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch OIDC configuration from discovery endpoint.
 */
export async function getOIDCConfig(
  usePublicUrl = false
): Promise<OIDCConfig> {
  if (_oidcConfig !== null) {
    return _oidcConfig;
  }

  const config = getAuthConfig();
  const discoveryUrl = usePublicUrl
    ? `${config.pocketIdPublicUrl}/.well-known/openid-configuration`
    : getOidcDiscoveryUrl();

  const response = await fetch(discoveryUrl, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC config: ${response.status}`);
  }

  const data = await response.json();

  // Replace public URLs with internal URLs for server-side calls
  const fixUrl = (url: string): string => {
    if (url && config.pocketIdPublicUrl) {
      return url.replace(config.pocketIdPublicUrl, config.pocketIdUrl);
    }
    return url;
  };

  _oidcConfig = {
    issuer: data.issuer, // Keep original for token validation
    authorizationEndpoint: data.authorization_endpoint, // Browser redirect, keep public
    tokenEndpoint: fixUrl(data.token_endpoint), // Server-side, use internal
    userinfoEndpoint: fixUrl(data.userinfo_endpoint), // Server-side, use internal
    jwksUri: fixUrl(data.jwks_uri), // Server-side, use internal
    endSessionEndpoint: data.end_session_endpoint, // Browser redirect, keep public
  };

  return _oidcConfig;
}

/**
 * Fetch JSON Web Key Set for token verification.
 */
export async function getJWKS(): Promise<{ keys: JsonWebKey[] }> {
  // Return cached JWKS if still valid
  if (
    _jwks !== null &&
    _jwksFetchedAt !== null &&
    Date.now() - _jwksFetchedAt < JWKS_CACHE_DURATION_MS
  ) {
    return _jwks;
  }

  const config = await getOIDCConfig();

  const response = await fetch(config.jwksUri, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }

  _jwks = await response.json();
  _jwksFetchedAt = Date.now();

  return _jwks!;
}

/**
 * Generate authorization URL for login redirect.
 */
export function getAuthorizationUrl(state: string, nonce: string): string {
  const config = getAuthConfig();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.pocketIdClientId,
    redirect_uri: config.authCallbackUrl,
    scope: "openid profile email",
    state,
    nonce,
  });

  return `${config.pocketIdPublicUrl}/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const config = getAuthConfig();
  const oidcConfig = await getOIDCConfig();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.authCallbackUrl,
    client_id: config.pocketIdClientId,
    client_secret: config.pocketIdClientSecret,
  });

  const response = await fetch(oidcConfig.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    tokenType: data.token_type || "Bearer",
    expiresIn: data.expires_in || 3600,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    scope: data.scope,
  };
}

/**
 * Fetch user info from OIDC provider.
 */
export async function getUserInfo(accessToken: string): Promise<UserInfo> {
  const oidcConfig = await getOIDCConfig();

  const response = await fetch(oidcConfig.userinfoEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  const data = await response.json();

  return {
    sub: data.sub,
    email: data.email,
    name: data.name,
    preferredUsername: data.preferred_username,
    picture: data.picture,
    groups: data.groups,
  };
}

/**
 * Get logout URL for ending session.
 */
export function getLogoutUrl(idToken?: string): string {
  const config = getAuthConfig();

  const params = new URLSearchParams({
    post_logout_redirect_uri: config.authCallbackUrl.replace(/\/callback$/, ""),
  });

  if (idToken) {
    params.set("id_token_hint", idToken);
  }

  return `${config.pocketIdPublicUrl}/logout?${params.toString()}`;
}

/**
 * Reset cached OIDC config (useful for testing).
 */
export function resetOIDCConfig(): void {
  _oidcConfig = null;
  _jwks = null;
  _jwksFetchedAt = null;
}
