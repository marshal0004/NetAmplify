// /home/z/my-project/netamplify-app/apps/frontend/src/lib/auth.tsx
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
import { authApi, setToken, getToken, ApiError } from './api';

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

/**
 * Extract field-level errors from an ApiError for form display.
 */
export function getFieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.fieldErrors) {
    return err.fieldErrors;
  }
  return {};
}

/**
 * Extract the top-level error message from any thrown error.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}
