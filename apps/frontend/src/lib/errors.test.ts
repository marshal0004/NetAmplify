// Vitest unit tests for lib/errors.ts — pure functions, no mocks.
//
// These helpers are the frontend's only bridge between the structured
// ApiError envelope (returned by the backend's errorMapper) and the UI:
//   getErrorMessage  → top-level message for error banners
//   getFieldErrors   → per-field messages for inline form errors
// They must never leak internal details for non-ApiError values (e.g. a
// network error or a thrown non-Error) — that path returns a safe fallback.

import { describe, it, expect } from 'vitest';
import { ApiError } from './api';
import { getErrorMessage, getFieldErrors } from './errors';

describe('getErrorMessage', () => {
  it('returns the ApiError message verbatim (incl. the descriptive publish message)', () => {
    const err = new ApiError(
      400,
      'VALIDATION_ERROR',
      "Invalid publish input: platforms.0.platform — Invalid enum value(s). Expected 'DISCORD' | ..., received 'PINTEREST'",
    );
    expect(getErrorMessage(err)).toBe(
      "Invalid publish input: platforms.0.platform — Invalid enum value(s). Expected 'DISCORD' | ..., received 'PINTEREST'",
    );
  });

  it('returns the message for a plain Error', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a safe fallback for non-Error values (no internal leaking)', () => {
    expect(getErrorMessage(null)).toBe('An unexpected error occurred');
    expect(getErrorMessage(undefined)).toBe('An unexpected error occurred');
    expect(getErrorMessage({ weird: true })).toBe('An unexpected error occurred');
    expect(getErrorMessage(42)).toBe('An unexpected error occurred');
    expect(getErrorMessage('a bare string')).toBe('An unexpected error occurred');
  });
});

describe('getFieldErrors', () => {
  it('returns fieldErrors from an ApiError that has them', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'msg', {
      'platforms.0.platform': "Invalid enum value(s). Expected 'DISCORD' | ..., received 'PINTEREST'",
    });
    expect(getFieldErrors(err)).toEqual({
      'platforms.0.platform': "Invalid enum value(s). Expected 'DISCORD' | ..., received 'PINTEREST'",
    });
  });

  it('returns {} for an ApiError without fieldErrors (e.g. UNAUTHENTICATED)', () => {
    const err = new ApiError(401, 'UNAUTHENTICATED', 'You must be logged in to NetAmplify.');
    expect(getFieldErrors(err)).toEqual({});
  });

  it('returns {} for an ApiError whose fieldErrors is an empty object', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'msg', {});
    expect(getFieldErrors(err)).toEqual({});
  });

  it('returns {} for non-ApiError values', () => {
    expect(getFieldErrors(new Error('boom'))).toEqual({});
    expect(getFieldErrors(null)).toEqual({});
    expect(getFieldErrors('string')).toEqual({});
    expect(getFieldErrors({ code: 'VALIDATION_ERROR' })).toEqual({});
  });
});
