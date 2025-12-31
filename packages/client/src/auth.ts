/**
 * Client-Side Authentication
 *
 * Handles Pocket ID OIDC authentication flow, token management,
 * and session state.
 */

// =============================================================================
// Types
// =============================================================================

/** User info from authentication */
export interface UserInfo {
  /** Unique user ID (subject) */
  sub: string;
  /** Display name */
  name: string;
  /** Email address */
  email?: string;
  /** Profile picture URL */
  picture?: string;
}

/** Authentication status */
export interface AuthStatus {
  /** Whether auth is enabled on the server */
  authEnabled: boolean;
  /** Whether auth is properly configured */
  configured: boolean;
  /** Whether user is authenticated */
  authenticated: boolean;
  /** Current user info */
  user: UserInfo | null;
}

/** Auth state change callback */
type AuthCallback = (status: AuthStatus) => void;

// =============================================================================
// Constants
// =============================================================================

const AUTH_API_BASE = "/api/auth";
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const LOCAL_STORAGE_KEY = "rune_forge_auth_cache";

// =============================================================================
// Auth Client
// =============================================================================

export class AuthClient {
  private status: AuthStatus | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<AuthCallback>();

  /**
   * Initialize the auth client.
   * Checks current auth status and starts token refresh.
   */
  async initialize(): Promise<AuthStatus> {
    // Check cached status first for faster initial load
    const cached = this.loadCachedStatus();
    if (cached) {
      this.status = cached;
      this.notifyListeners();
    }

    // Fetch current status from server
    try {
      const status = await this.fetchStatus();
      this.status = status;
      this.cacheStatus(status);
      this.notifyListeners();

      // Start refresh interval if authenticated
      if (status.authenticated) {
        this.startRefreshInterval();
      }

      return status;
    } catch (error) {
      console.error("[auth] Failed to initialize:", error);

      // Return cached or default status on error
      return (
        cached ?? {
          authEnabled: false,
          configured: false,
          authenticated: false,
          user: null,
        }
      );
    }
  }

  /**
   * Subscribe to auth status changes.
   */
  onStatusChange(callback: AuthCallback): () => void {
    this.listeners.add(callback);

    // Call immediately with current status
    if (this.status) {
      callback(this.status);
    }

    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Get current auth status.
   */
  getStatus(): AuthStatus | null {
    return this.status;
  }

  /**
   * Check if user is authenticated.
   */
  isAuthenticated(): boolean {
    return this.status?.authenticated ?? false;
  }

  /**
   * Get current user.
   */
  getUser(): UserInfo | null {
    return this.status?.user ?? null;
  }

  /**
   * Initiate login flow.
   * Redirects to Pocket ID login page.
   */
  login(redirectUri?: string): void {
    let loginUrl = `${AUTH_API_BASE}/login`;

    if (redirectUri) {
      loginUrl += `?redirect_uri=${encodeURIComponent(redirectUri)}`;
    }

    window.location.href = loginUrl;
  }

  /**
   * Dev login (no OIDC required).
   * Only works when auth is not enabled/configured.
   */
  devLogin(name: string, redirectUri?: string): void {
    let loginUrl = `${AUTH_API_BASE}/dev-login?name=${encodeURIComponent(name)}`;

    if (redirectUri) {
      loginUrl += `&redirect_uri=${encodeURIComponent(redirectUri)}`;
    }

    window.location.href = loginUrl;
  }

  /**
   * Logout the current user.
   *
   * @param sso - If true, also log out from the identity provider
   */
  logout(sso = false): void {
    // Clear local state
    this.status = null;
    this.clearCachedStatus();
    this.stopRefreshInterval();
    this.notifyListeners();

    // Redirect to logout endpoint
    const logoutUrl = sso
      ? `${AUTH_API_BASE}/logout/sso`
      : `${AUTH_API_BASE}/logout`;

    window.location.href = logoutUrl;
  }

  /**
   * Get the session token for WebSocket authentication.
   * Returns the session cookie value.
   */
  getSessionToken(): string | null {
    const cookies = document.cookie.split(";");

    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split("=");
      if (name === "session" && value) {
        return decodeURIComponent(value);
      }
    }

    return null;
  }

  /**
   * Refresh the session token.
   */
  async refresh(): Promise<boolean> {
    try {
      const response = await fetch(`${AUTH_API_BASE}/refresh`);

      if (!response.ok) {
        if (response.status === 401) {
          // Session expired, clear auth state
          this.status = {
            ...this.status!,
            authenticated: false,
            user: null,
          };
          this.clearCachedStatus();
          this.stopRefreshInterval();
          this.notifyListeners();
        }
        return false;
      }

      // Re-fetch status after refresh
      const status = await this.fetchStatus();
      this.status = status;
      this.cacheStatus(status);
      this.notifyListeners();

      return true;
    } catch (error) {
      console.error("[auth] Refresh failed:", error);
      return false;
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async fetchStatus(): Promise<AuthStatus> {
    const response = await fetch(`${AUTH_API_BASE}/status`);

    if (!response.ok) {
      throw new Error(`Failed to fetch auth status: ${response.statusText}`);
    }

    return response.json();
  }

  private notifyListeners(): void {
    if (this.status) {
      for (const callback of this.listeners) {
        try {
          callback(this.status);
        } catch (error) {
          console.error("[auth] Listener error:", error);
        }
      }
    }
  }

  private startRefreshInterval(): void {
    this.stopRefreshInterval();

    this.refreshInterval = setInterval(() => {
      this.refresh().catch((error) => {
        console.error("[auth] Auto-refresh failed:", error);
      });
    }, REFRESH_INTERVAL_MS);
  }

  private stopRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private loadCachedStatus(): AuthStatus | null {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  private cacheStatus(status: AuthStatus): void {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(status));
    } catch {
      // Ignore storage errors
    }
  }

  private clearCachedStatus(): void {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}

// Export singleton instance
export const authClient = new AuthClient();
