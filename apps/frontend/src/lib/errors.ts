// NetAmplify — error-display utilities (extracted from auth.tsx).
//
// These are pure non-component helpers. Keeping them in a separate module from
// the AuthProvider component is REQUIRED for React Fast Refresh: a file that
// mixes a component export (AuthProvider) with non-component exports
// (getErrorMessage, getFieldErrors) breaks HMR — Vite logs
// "Could not Fast Refresh (getErrorMessage export is incompatible)" and falls
// back to a full page reload on every change, which re-runs the /me check and
// can surface stale-token errors mid-session.

import { ApiError } from './api';

/**
 * Extract field-level errors from an ApiError for form display.
 * Returns {} if the error has no fieldErrors (e.g., a network error or a
 * non-validation ApiError).
 */
export function getFieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.fieldErrors) {
    return err.fieldErrors;
  }
  return {};
}

/**
 * Extract the top-level error message from any thrown error.
 * - ApiError → its structured message (e.g., "Invalid publish input: …")
 * - plain Error → its message
 * - anything else → a safe fallback (never leaks internals to the UI)
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}
