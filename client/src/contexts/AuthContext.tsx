/// <reference types="vite/client" />
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { parseJwt } from '../utils/auth/jwt.ts';
import { disconnect } from '../network/spacetimedbClient.ts';
// Removed Node.js specific imports
// import { Buffer } from 'buffer';
// import crypto from 'crypto';

// --- Environment-based Configuration ---
const isDevelopment = import.meta.env.DEV || window.location.hostname === 'localhost';

const AUTH_SERVER_URL = (
  import.meta.env.VITE_AUTH_SERVER_URL
  ?? (isDevelopment ? 'http://localhost:4001' : (typeof window !== 'undefined' ? window.location.origin : ''))
).replace(/\/+$/, '');
const AUTH_ISSUER = AUTH_SERVER_URL;

const OIDC_CLIENT_ID = import.meta.env.VITE_AUTH_CLIENT_ID ?? 'vibe-survival-game-client';
const REDIRECT_URI = window.location.origin + '/callback';
const REFRESH_THRESHOLD_SECONDS = 2 * 60; // Refresh shortly before the 15-minute token expires
const VALIDITY_CHECK_INTERVAL_MS = 60 * 1000;
const LOCAL_STORAGE_KEYS = {
    ID_TOKEN: 'oidc_id_token',
    ACCESS_TOKEN: 'oidc_access_token',
    PKCE_VERIFIER: 'pkce_verifier',
    OIDC_STATE: 'oidc_state',
};

interface UserProfile {
    userId: string; // Extracted from id_token subject
    email?: string; // Email from id_token if available
    // Add other relevant fields if available in the token (e.g., username)
}

interface AuthContextType {
  userProfile: UserProfile | null;      // Simplified user info from token
  spacetimeToken: string | null;      // This will be the id_token
  isLoading: boolean;                 // Is an auth operation in progress?
  isAuthenticated: boolean;           // Based on presence of spacetimeToken
  authError: string | null;           // Store auth-related errors
  loginRedirect: () => Promise<void>; // Function to start login flow
  logout: () => Promise<void>;        // Function to logout
  handleRedirectCallback: () => Promise<void>; // Function to process callback
  invalidateCurrentToken: () => void; // New function to invalidate token
}

const AuthContext = createContext<AuthContextType>({
  userProfile: null,
  spacetimeToken: null,
  isLoading: true, // Start loading until initial check is done
  isAuthenticated: false,
  authError: null,
  loginRedirect: async () => { console.warn("AuthContext not initialized"); },
  logout: async () => { console.warn("AuthContext not initialized"); },
  handleRedirectCallback: async () => { console.warn("AuthContext not initialized"); },
  invalidateCurrentToken: () => { console.warn("AuthContext not initialized"); },
});

interface AuthProviderProps {
  children: ReactNode;
}

// Helper function for Base64URL encoding in browser
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    // Standard Base64 encoding
    const base64 = window.btoa(binary);
    // Convert Base64 to Base64URL
    return base64
        .replace(/\+/g, '-') // Replace + with -
        .replace(/\//g, '_') // Replace / with _
        .replace(/=/g, '');   // Remove padding =
}

// Helper function for PKCE using Web Crypto API
async function generatePkceChallenge(verifier: string): Promise<{ code_verifier: string; code_challenge: string; code_challenge_method: string }> {
    const code_verifier = verifier;
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    // Use Web Crypto API for SHA-256
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    // Encode the ArrayBuffer result to Base64URL
    const code_challenge = arrayBufferToBase64Url(digest);
    return {
        code_verifier,
        code_challenge,
        code_challenge_method: 'S256'
    };
}

function generateRandomString(length: number): string {
    const bytes = new Uint8Array(Math.ceil((length * 3) / 4));
    window.crypto.getRandomValues(bytes);
    return arrayBufferToBase64Url(bytes.buffer).slice(0, length);
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [spacetimeToken, setSpacetimeToken] = useState<string | null>(() => {
      const storedToken = sessionStorage.getItem(LOCAL_STORAGE_KEYS.ID_TOKEN);
      // console.log(`[AuthContext LOG] Initializing token state. Found in storage: ${!!storedToken}`); // <-- LOG initialization
      return storedToken;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const navigateToRoot = useCallback(() => {
    window.history.replaceState({}, document.title, '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  // --- Core Auth Functions ---

  const loginRedirect = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
        // console.log("[AuthContext] Initiating login redirect manually for password flow...");

        // 1. Generate PKCE Verifier and Challenge
        const verifier = generateRandomString(128); // Generate a random verifier
        const pkce = await generatePkceChallenge(verifier);
        sessionStorage.setItem(LOCAL_STORAGE_KEYS.PKCE_VERIFIER, pkce.code_verifier);

        // 2. Generate State (for CSRF protection; validate on callback)
        const state = generateRandomString(32);
        sessionStorage.setItem(LOCAL_STORAGE_KEYS.OIDC_STATE, state);

        // 3. Construct Authorization URL
        const authUrl = new URL('/authorize', AUTH_SERVER_URL);
        authUrl.searchParams.set('client_id', OIDC_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', pkce.code_challenge);
        authUrl.searchParams.set('code_challenge_method', pkce.code_challenge_method);
        authUrl.searchParams.set('acr_values', 'pwd'); // Add acr_values

        // console.log("[AuthContext] Redirecting to manually constructed URL:", authUrl.toString());
        window.location.assign(authUrl.toString()); // Redirect user

    } catch (error: unknown) {
        console.error("[AuthContext] Error initiating manual login redirect:", error);
        setAuthError(error instanceof Error ? error.message : "Failed to start login process");
        setIsLoading(false);
    }
  }, []); // Removed oidcClient dependency as we're not using its authorize method directly

  const handleRedirectCallback = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    // console.log("[AuthContext LOG] START: Handling redirect callback...");

    const queryParams = new URLSearchParams(window.location.search);
    const code = queryParams.get("code");
    const error = queryParams.get("error");
    const returnedState = queryParams.get("state");
    const expectedState = sessionStorage.getItem(LOCAL_STORAGE_KEYS.OIDC_STATE);

    if ((code || error) && (!returnedState || !expectedState || returnedState !== expectedState)) {
        sessionStorage.removeItem(LOCAL_STORAGE_KEYS.OIDC_STATE);
        sessionStorage.removeItem(LOCAL_STORAGE_KEYS.PKCE_VERIFIER);
        setAuthError("Authentication response could not be verified. Please sign in again.");
        setIsLoading(false);
        navigateToRoot();
        return;
    }

    if (code || error) {
        sessionStorage.removeItem(LOCAL_STORAGE_KEYS.OIDC_STATE);
    }

    window.history.replaceState({}, document.title, window.location.pathname);

    if (!code) {
        // Check for error parameters (e.g., error=access_denied)
        const errorDesc = queryParams.get("error_description");
        if (error) {
             setAuthError(`Authentication failed: ${error} ${errorDesc ? `(${errorDesc})` : ''}`);
        } else {
            // No code: direct navigation to /callback, refresh, or cancelled login
            const existingToken = sessionStorage.getItem(LOCAL_STORAGE_KEYS.ID_TOKEN);
            if (existingToken) {
                 setSpacetimeToken(existingToken);
                 const profile = parseToken(existingToken);
                 setUserProfile(profile);
            } else {
                navigateToRoot();
            }
        }
        setIsLoading(false);
        navigateToRoot();
        return;
    }

    const verifier = sessionStorage.getItem(LOCAL_STORAGE_KEYS.PKCE_VERIFIER);
    if (!verifier) {
        setAuthError("Session expired. Please sign in again.");
        setIsLoading(false);
        navigateToRoot();
        return;
    }

    try {
        // console.log("[AuthContext LOG] Exchanging code for tokens...");

        // Construct form data payload for the token endpoint
        const tokenRequestBody = new URLSearchParams();
        tokenRequestBody.append('grant_type', 'authorization_code');
        tokenRequestBody.append('code', code!); // Code is guaranteed to exist here
        tokenRequestBody.append('redirect_uri', REDIRECT_URI);
        tokenRequestBody.append('client_id', OIDC_CLIENT_ID);
        tokenRequestBody.append('code_verifier', verifier);

        // Make the POST request to the token endpoint
        const tokenResponse = await fetch(`${AUTH_SERVER_URL}/token`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: tokenRequestBody.toString(),
        });

        const tokens = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error("[AuthContext] Token exchange failed:", tokens);
            const errorDescription = tokens.error_description || tokens.error || `HTTP status ${tokenResponse.status}`;
            throw new Error(`Token exchange failed: ${errorDescription}`);
        }

        // Extract tokens directly from the JSON response
        const id_token = tokens.id_token as string | undefined;
        const access_token = tokens.access_token as string | undefined;

        // console.log("[AuthContext LOG] Tokens received (id_token present?):", !!id_token);

        if (!id_token) {
             throw new Error("id_token missing from token response");
        }

        // Store tokens
        sessionStorage.setItem(LOCAL_STORAGE_KEYS.ID_TOKEN, id_token);
        if (access_token) sessionStorage.setItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN, access_token);

        // Set state (This will trigger the useEffect below)
        // console.log("[AuthContext LOG] Setting spacetimeToken state AFTER successful callback.");
        setSpacetimeToken(id_token);
        const profile = parseToken(id_token);
        setUserProfile(profile);
        setAuthError(null);
        sessionStorage.removeItem(LOCAL_STORAGE_KEYS.PKCE_VERIFIER); // Only remove after success

        navigateToRoot();

    } catch (error: unknown) {
        console.error("[AuthContext] Error handling redirect callback:", error);
        setAuthError(error instanceof Error ? error.message : "Failed to process login callback");
        // Clear potentially partial tokens
        clearTokens();
        setSpacetimeToken(null);
        setUserProfile(null);
        navigateToRoot();
        // console.log("[AuthContext LOG] END: Error during callback handling.");
    } finally {
        setIsLoading(false);
    }
  }, [navigateToRoot]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    // Explicitly disconnect SpacetimeDB before redirect so the server can clean up.
    // Without this, the page unloads before the disconnect is sent, leaving the
    // server in a bad state that blocks re-login until the server is restarted.
    try {
      disconnect();
    } catch {
      // Ignore; we're logging out anyway
    }
    try {
      const body = new URLSearchParams();
      body.append('token_type_hint', 'refresh_token');
      await fetch(`${AUTH_SERVER_URL}/revoke`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      // Ignore revoke errors; we clear local state anyway
    }
    clearTokens();
    setSpacetimeToken(null);
    setUserProfile(null);
    setAuthError(null);
    setIsLoading(false);
    // Keep app in SPA flow; avoid hard reload race on reconnect.
    navigateToRoot();
  }, [navigateToRoot]);

  // --- Helper Functions ---
  const clearTokens = () => {
    sessionStorage.removeItem(LOCAL_STORAGE_KEYS.ID_TOKEN);
    sessionStorage.removeItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN);
    sessionStorage.removeItem(LOCAL_STORAGE_KEYS.PKCE_VERIFIER);
    sessionStorage.removeItem(LOCAL_STORAGE_KEYS.OIDC_STATE);
    setSpacetimeToken(null);
    setUserProfile(null);
  };

  const refreshTokens = useCallback(async (): Promise<boolean> => {
    try {
      const body = new URLSearchParams();
      body.append('grant_type', 'refresh_token');
      body.append('client_id', OIDC_CLIENT_ID);

      const res = await fetch(`${AUTH_SERVER_URL}/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const data = await res.json();
      if (!res.ok) {
        console.warn('[AuthContext] Token refresh failed:', data);
        return false;
      }

      const id_token = data.id_token as string | undefined;
      const access_token = data.access_token as string | undefined;

      if (!id_token) return false;

      sessionStorage.setItem(LOCAL_STORAGE_KEYS.ID_TOKEN, id_token);
      if (access_token) sessionStorage.setItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN, access_token);

      setSpacetimeToken(id_token);
      const profile = parseToken(id_token);
      if (profile) setUserProfile(profile);
      return true;
    } catch (err) {
      console.warn('[AuthContext] Token refresh error:', err);
      return false;
    }
    }, []);

  const parseToken = (token: string): UserProfile | null => {
       try {
            const decoded = parseJwt(token);

            // Check if token is expired
            const now = Math.floor(Date.now() / 1000);
            if (!decoded.exp || decoded.exp <= now) {
                console.warn("[AuthContext] Token is expired");
                return null;
            }
            const audience = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
            if (
              decoded.iss !== AUTH_ISSUER
              || !audience.includes(OIDC_CLIENT_ID)
              || decoded.account_active !== true
              || decoded.token_use !== 'id'
            ) {
              console.warn("[AuthContext] Token claims do not match this application");
              return null;
            }

            const userId = decoded.sub || decoded.userId;
            if (!userId) {
                 console.error("Could not find userId (sub or userId) in token payload:", decoded);
                 return null;
            }

            // Extract email from token
            const email = decoded.email || undefined;

            return {
                userId: userId,
                email: email
            };
       } catch (error) {
            console.error("Error parsing token:", error);
            // Don't set authError here directly, let callers handle
            return null;
       }
  };

  // Helper function to validate if current token is still valid
  const isTokenValid = useCallback(() => {
    if (!spacetimeToken) return false;

    try {
      const decoded = parseJwt(spacetimeToken);
      const now = Math.floor(Date.now() / 1000);

      // Check expiration
      if (!decoded.exp || decoded.exp <= now) {
        console.warn("[AuthContext] Token validation failed: Token is expired");
        return false;
      }
      const audience = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
      if (
        decoded.iss !== AUTH_ISSUER
        || !audience.includes(OIDC_CLIENT_ID)
        || decoded.account_active !== true
        || decoded.token_use !== 'id'
      ) {
        console.warn("[AuthContext] Token validation failed: Issuer, audience, or account status claim mismatch");
        return false;
      }

      // Check required fields
      if (!decoded.sub && !decoded.userId) {
        console.warn("[AuthContext] Token validation failed: Missing user ID");
        return false;
      }

      return true;
    } catch (error) {
      console.warn("[AuthContext] Token validation failed: Parse error", error);
      return false;
    }
  }, [spacetimeToken]);

  const invalidateCurrentToken = useCallback(() => {
    console.warn("[AuthContext LOG] Current token is being invalidated, likely due to rejection by a service (e.g., SpacetimeDB).");
    const tokenExistedPriorToInvalidation = !!sessionStorage.getItem(LOCAL_STORAGE_KEYS.ID_TOKEN);

    try {
      disconnect();
    } catch {
      // Ignore
    }
    void fetch(`${AUTH_SERVER_URL}/revoke`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token_type_hint=refresh_token',
    }).catch(() => undefined);
    clearTokens();

    if (tokenExistedPriorToInvalidation) {
      setAuthError("Your session was rejected or has expired. Please sign in again.");
    } else {
      console.warn("[AuthContext LOG] invalidateCurrentToken called, but no token was present in storage to invalidate.");
    }
    setIsLoading(false);

    navigateToRoot();
  }, [navigateToRoot]);

  // --- Effect for Initial Load / Handling Redirect ---
  useEffect(() => {
    // Remove credentials written by older builds. Refresh credentials are now
    // server-managed HttpOnly cookies and short-lived tokens are tab-scoped.
    localStorage.removeItem('oidc_id_token');
    localStorage.removeItem('oidc_access_token');
    localStorage.removeItem('oidc_refresh_token');
    localStorage.removeItem('pkce_verifier');

    if (window.location.pathname === new URL(REDIRECT_URI).pathname) {
      handleRedirectCallback();
      return;
    }

    (async () => {
      if (spacetimeToken) {
        const profile = parseToken(spacetimeToken);
        if (profile) {
          setUserProfile(profile);
          setIsLoading(false);
          return;
        }
      }

      // The refresh token is an HttpOnly cookie, so a new tab can restore its
      // short-lived ID token without exposing the refresh credential to JS.
      const refreshed = await refreshTokens();
      if (!refreshed) {
        clearTokens();
      }
      setIsLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleRedirectCallback]);

  // --- Effect to Log Token Changes ---
  useEffect(() => {
    // This log will now reflect changes from login, logout, or clearing invalid tokens
    // console.log("[AuthContext LOG] spacetimeToken STATE CHANGED to:", spacetimeToken ? `token starting with ${spacetimeToken.substring(0, 10)}...` : null);
  }, [spacetimeToken]);

  const isAuthenticated = !!spacetimeToken && isTokenValid();
  const refreshTokensRef = useRef(refreshTokens);
  refreshTokensRef.current = refreshTokens;

  // Periodic token validity check and proactive refresh
  useEffect(() => {
    if (!spacetimeToken) return;

    const checkAndRefresh = async () => {
      try {
        const decoded = parseJwt(spacetimeToken);
        const now = Math.floor(Date.now() / 1000);
        const exp = decoded.exp as number | undefined;

        if (!exp) {
          console.warn('[AuthContext] Token has no exp, clearing');
          clearTokens();
          return;
        }

        if (exp < now) {
          // Expired: try refresh first, else clear
          const refreshed = await refreshTokensRef.current();
          if (!refreshed) {
            console.warn('[AuthContext] Token expired and refresh failed, clearing');
            clearTokens();
          }
          return;
        }

        const secondsUntilExpiry = exp - now;
        if (secondsUntilExpiry < REFRESH_THRESHOLD_SECONDS) {
          const refreshed = await refreshTokensRef.current();
          if (!refreshed) {
            console.warn('[AuthContext] Proactive refresh failed');
          }
        }
      } catch {
        clearTokens();
      }
    };

    checkAndRefresh(); // Run immediately
    const interval = setInterval(checkAndRefresh, VALIDITY_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [spacetimeToken]);

  return (
    <AuthContext.Provider
      value={{
        userProfile,
        spacetimeToken,
        isLoading,
        isAuthenticated,
        authError,
        loginRedirect,
        logout,
        handleRedirectCallback,
        invalidateCurrentToken
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// Auth state and its hook intentionally share this module.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
