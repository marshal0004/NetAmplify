// NetAmplify — Auth context provider.
//
// Per docs/02-SRS.md FR-001: JWT-based auth, 7-day expiry.
// The token is stored in localStorage (MVP simplification — in production
// this should be an httpOnly cookie set by the server).
//
// Provides:
//   - user: current user info (or null if not logged in)
//   - login(email, password): Promise<void>
//   - signup(email, password, name): Promise<void>
//   - logout(): Promise<void>
//   - isLoading: boolean (true during initial token validation)
//   - error: string | null (last auth error)

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi, setToken, getToken } from './api';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: if token exists, validate it by calling /me
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIsLoading(false);
      return;
    }
    authApi.me()
      .then((u) => setUser(u))
      .catch(() => {
        // Token is invalid or expired — clear it
        setToken(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // Listen for 'netamplify:unauthorized' dispatched by the api client (lib/api.ts)
  // on any 401 response, or when a guarded request is attempted with no token.
  // Clears the user state so RequireAuth redirects to /login. Without this, a
  // 401 clears the token (api.ts setToken(null)) but leaves `user` stale —
  // RequireAuth keeps passing while localStorage is empty, so raw-fetch
  // handlers (PostCardComposer upload, etc.) send `Bearer null` → backend
  // "jwt malformed". This desync was the root cause of the upload 401 cascade.
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('netamplify:unauthorized', handler);
    return () => window.removeEventListener('netamplify:unauthorized', handler);
  }, []);

  async function login(email: string, password: string) {
    const result = await authApi.login(email, password);
    setToken(result.accessToken);
    setUser(result.user);
  }

  async function signup(email: string, password: string, name: string) {
    const result = await authApi.signup(email, password, name);
    setToken(result.accessToken);
    setUser(result.user);
  }

  async function logout() {
    try {
      await authApi.logout();
    } catch {
      // Ignore network errors on logout — token is cleared locally regardless
    }
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

// getErrorMessage + getFieldErrors moved to ./errors.ts (HMR Fast Refresh fix:
// mixing a component export with non-component exports breaks Vite HMR —
// "Could not Fast Refresh (getErrorMessage export is incompatible)" → full
// page reload on every auth.tsx change).
