/**
 * AuthContext - Manages authentication state for Sentris OS Electron app
 *
 * Supports:
 * - Google OAuth via Supabase (opens in system browser)
 * - Email/password authentication
 * - Session persistence via secure Electron storage
 * - Deep link callback handling (sentris://auth/callback)
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

// API Base URL - Production or development
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:5001";

// Storage keys for auth persistence
const AUTH_STORAGE_KEYS = {
  ACCESS_TOKEN: "sentris_access_token",
  REFRESH_TOKEN: "sentris_refresh_token",
  USER: "sentris_user",
  AUTH_PROVIDER: "sentris_auth_provider",
};

// Create context
const AuthContext = createContext(null);

// Custom hook for using auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Auth Provider component
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Track processed OAuth codes to prevent duplicate handling
  const processedCodesRef = React.useRef(new Set());
  // Track OAuth timeout to clear it when callback arrives
  const oauthTimeoutRef = React.useRef(null);

  // Initialize auth state from storage
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Try to load existing session from secure storage
        const storedToken = localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
        const storedUser = localStorage.getItem(AUTH_STORAGE_KEYS.USER);

        if (storedToken && storedUser) {
          // Verify token is still valid
          const isValid = await verifyToken(storedToken);

          if (isValid) {
            setUser(JSON.parse(storedUser));
            setSession({ access_token: storedToken });
            console.log("[AuthContext] ✅ Session restored from storage");
          } else {
            // Try to refresh the token
            const refreshToken = localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
            if (refreshToken) {
              const refreshResult = await refreshSession(refreshToken);
              if (!refreshResult.success) {
                // Clear invalid session
                clearAuthStorage();
              }
            } else {
              clearAuthStorage();
            }
          }
        }
      } catch (err) {
        console.error("[AuthContext] Init error:", err);
        clearAuthStorage();
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Listen for deep link auth callbacks
    if (window.electronAPI?.onAuthCallback) {
      const unsubscribe = window.electronAPI.onAuthCallback((data) => {
        console.log("[AuthContext] 🔗 Auth callback received:", data);

        // Prevent duplicate processing of the same OAuth code
        if (data.code) {
          if (processedCodesRef.current.has(data.code)) {
            console.log("[AuthContext] ⚠️ OAuth code already processed, skipping duplicate");
            // Still reset loading state for duplicate callbacks
            setLoading(false);
            return;
          }
          processedCodesRef.current.add(data.code);
        }

        // Handle OAuth errors from the callback
        if (data.error) {
          console.error("[AuthContext] ❌ OAuth error:", data.error, data.error_description);
          setError(data.error_description || data.error);
          setLoading(false);
          return;
        }

        handleOAuthCallback(data);
      });

      return () => unsubscribe?.();
    }
  }, []);

  // Verify token with backend
  const verifyToken = async (token) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  // Clear auth storage
  const clearAuthStorage = () => {
    Object.values(AUTH_STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });
    setUser(null);
    setSession(null);
  };

  // Save auth to storage
  const saveAuthToStorage = (userData, sessionData) => {
    if (sessionData?.access_token) {
      localStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, sessionData.access_token);
    }
    if (sessionData?.refresh_token) {
      localStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, sessionData.refresh_token);
    }
    if (userData) {
      localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(userData));
    }
  };

  // Sign up with email/password
  const signUp = async (email, password, metadata = {}) => {
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, metadata }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Sign up failed");
      }

      if (data.user && data.session) {
        setUser(data.user);
        setSession(data.session);
        saveAuthToStorage(data.user, data.session);
        console.log("[AuthContext] ✅ Sign up successful");
        return { success: true, user: data.user };
      }

      // Email confirmation required
      return { success: true, requiresConfirmation: true };
    } catch (err) {
      const errorMsg = err.message || "Sign up failed";
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  };

  // Sign in with email/password
  const signIn = async (email, password) => {
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Sign in failed");
      }

      setUser(data.user);
      setSession(data.session);
      saveAuthToStorage(data.user, data.session);
      localStorage.setItem(AUTH_STORAGE_KEYS.AUTH_PROVIDER, "email");

      console.log("[AuthContext] ✅ Sign in successful");
      return { success: true, user: data.user };
    } catch (err) {
      const errorMsg = err.message || "Sign in failed";
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  };

  // Sign in with OAuth (Google)
  const signInWithOAuth = async (provider = "google") => {
    setError(null);

    // Clear processed codes for new OAuth flow
    processedCodesRef.current.clear();

    try {
      // Determine redirect URL based on environment
      // Desktop app uses deep link protocol, web uses callback page
      const isElectron = Boolean(window.electronAPI?.openExternal);
      const redirectTo = isElectron
        ? "sentris://auth/callback" // Desktop: deep link protocol
        : `${window.location.origin}/auth/callback`; // Web: standard callback

      // Get OAuth URL from backend with the correct redirect URL
      const response = await fetch(`${API_BASE_URL}/api/auth/oauth/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_to: redirectTo }),
      });

      const data = await response.json();

      if (!response.ok || !data.url) {
        throw new Error(data.error || "Failed to get OAuth URL");
      }

      // Open OAuth URL in system browser (Electron handles deep link callback)
      console.log("[AuthContext] 🔐 Opening OAuth URL in browser...", { redirectTo });

      if (isElectron) {
        await window.electronAPI.openExternal(data.url);
      } else {
        // Fallback for web
        window.open(data.url, "_blank");
      }

      localStorage.setItem(AUTH_STORAGE_KEYS.AUTH_PROVIDER, provider);

      // Set loading AFTER browser opens - will be reset when callback arrives
      // This provides visual feedback that we're waiting for OAuth
      setLoading(true);

      // Safety timeout: reset loading if callback doesn't arrive in 3 minutes
      // (user might close browser without completing auth)
      if (oauthTimeoutRef.current) {
        clearTimeout(oauthTimeoutRef.current);
      }
      oauthTimeoutRef.current = setTimeout(
        () => {
          console.log("[AuthContext] ⏱️ OAuth timeout - resetting loading state");
          setLoading(false);
          oauthTimeoutRef.current = null;
        },
        3 * 60 * 1000,
      );

      // The actual auth completion happens via deep link callback
      return { success: true, pending: true };
    } catch (err) {
      const errorMsg = err.message || "OAuth sign in failed";
      setError(errorMsg);
      setLoading(false);
      return { success: false, error: errorMsg };
    }
  };

  // Handle OAuth callback from deep link
  const handleOAuthCallback = async (callbackData) => {
    // Clear the safety timeout since callback arrived
    if (oauthTimeoutRef.current) {
      clearTimeout(oauthTimeoutRef.current);
      oauthTimeoutRef.current = null;
    }

    setLoading(true);

    try {
      // callbackData contains { code, state } or { access_token, refresh_token }
      let response;

      if (callbackData.access_token) {
        // Direct token received
        setSession({
          access_token: callbackData.access_token,
          refresh_token: callbackData.refresh_token,
        });

        // Get user info
        response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${callbackData.access_token}`,
          },
        });

        const userData = await response.json();
        if (response.ok && userData.user) {
          setUser(userData.user);
          saveAuthToStorage(userData.user, callbackData);
          console.log("[AuthContext] ✅ OAuth callback successful");
          return { success: true, user: userData.user };
        }
      } else if (callbackData.code) {
        // Exchange code for tokens
        response = await fetch(`${API_BASE_URL}/api/auth/oauth/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(callbackData),
        });

        const data = await response.json();

        if (response.ok && data.user && data.session) {
          setUser(data.user);
          setSession(data.session);
          saveAuthToStorage(data.user, data.session);
          console.log("[AuthContext] ✅ OAuth code exchange successful");
          return { success: true, user: data.user };
        }
      }

      throw new Error("Invalid OAuth callback data");
    } catch (err) {
      const errorMsg = err.message || "OAuth callback failed";
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  };

  // Refresh session
  const refreshSession = async (refreshToken) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      const data = await response.json();

      if (response.ok && data.session) {
        setSession(data.session);
        if (data.user) {
          setUser(data.user);
        }
        saveAuthToStorage(data.user, data.session);
        console.log("[AuthContext] ✅ Session refreshed");
        return { success: true };
      }

      return { success: false };
    } catch {
      return { success: false };
    }
  };

  // Sign out
  const signOut = useCallback(async () => {
    try {
      const token = localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);

      if (token) {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
      }
    } catch (err) {
      console.error("[AuthContext] Sign out error:", err);
    } finally {
      clearAuthStorage();
      console.log("[AuthContext] ✅ Signed out");
    }
  }, []);

  // Get current access token
  const getAccessToken = useCallback(() => {
    return session?.access_token || localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
  }, [session]);

  // Check if user is authenticated
  const isAuthenticated = Boolean(user && session?.access_token);

  // Context value
  const value = {
    user,
    session,
    loading,
    error,
    isAuthenticated,
    signUp,
    signIn,
    signInWithOAuth,
    signOut,
    getAccessToken,
    refreshSession: () => refreshSession(localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN)),
    clearError: () => setError(null),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthContext;
