import { create } from "zustand";
import { webClient } from "@/api/web-client";

const WEB_AUTH_STORAGE_KEY = "wavespeed_web_auth_state";

interface WebAuthUser {
  email: string;
  org_id: string;
  user_id: string;
  org_name: string;
  user_name: string;
  exp?: number; // JWT expiration timestamp
}

interface WebAuthState {
  user: WebAuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: () => Promise<{ success: boolean; error?: string }>;
  signOut: () => void;
  _hydrate: () => Promise<void>; // Internal: load token from secure storage
}

/**
 * Decode JWT payload (without verification - we trust the source)
 * Returns null if token is invalid or expired
 */
function decodeJWTPayload(token: string): WebAuthUser | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]));

    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      console.warn("[WebAuth] Token expired");
      return null;
    }

    return {
      email: payload.email || "",
      org_id: payload.org_id || "",
      user_id: payload.user_id || "",
      org_name: payload.org_name || "",
      user_name: payload.user_name || "",
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export const useWebAuthStore = create<WebAuthState>()((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,

  // Hydrate auth state from secure storage on app load
  _hydrate: async () => {
    if (typeof window === "undefined" || !window.electronAPI) return;

    try {
      const token = await window.electronAPI.getWebAuthToken();
      if (token) {
        const user = decodeJWTPayload(token);
        if (user) {
          webClient.setToken(token);
          set({ user, isAuthenticated: true });
        } else {
          // Token invalid or expired, clear it
          await window.electronAPI.removeWebAuthToken();
        }
      }
    } catch (err) {
      console.error("[WebAuth] Failed to hydrate auth state:", err);
    }
  },

  signIn: async () => {
    set({ isLoading: true });
    try {
      if (!window.electronAPI) {
        set({ isLoading: false });
        return { success: false, error: "Electron API not available" };
      }

      const result = await window.electronAPI.webAuthSignIn();

      if (result.success && result.token) {
        const user = decodeJWTPayload(result.token);
        if (!user) {
          set({ isLoading: false });
          return { success: false, error: "Invalid authentication token" };
        }

        // Store token securely in main process
        await window.electronAPI.setWebAuthToken(result.token);
        webClient.setToken(result.token);

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
        return { success: true };
      } else {
        set({ isLoading: false });
        return { success: false, error: result.error };
      }
    } catch (error) {
      set({ isLoading: false });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
      };
    }
  },

  signOut: async () => {
    // Clear token from secure storage
    try {
      if (window.electronAPI) {
        await window.electronAPI.removeWebAuthToken();
      }
    } catch (err) {
      console.error("[WebAuth] Failed to clear token:", err);
    }

    webClient.clearToken();
    set({
      user: null,
      isAuthenticated: false,
    });
  },
}));

// Hydrate auth state on store creation (only in browser)
if (typeof window !== "undefined") {
  useWebAuthStore.getState()._hydrate();
}
