// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/oauth/pkce.test.ts
// Vitest unit tests for PKCE helpers — pure functions, no mocks.

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  generateState,
  generatePkcePair,
  verifyState,
} from './pkce';

describe('generateState', () => {
  it('returns a base64url-encoded string', () => {
    const state = generateState();
    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(10);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns different values on each call (fresh randomness)', () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1).not.toBe(s2);
  });

  it('respects the length parameter', () => {
    const short = generateState(8);
    const long = generateState(64);
    expect(short.length).toBeLessThan(long.length);
  });
});

describe('generatePkcePair', () => {
  it('returns a valid S256 PKCE pair', () => {
    const pair = generatePkcePair();
    expect(pair.code_challenge_method).toBe('S256');
    expect(pair.code_verifier).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(pair.code_challenge).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('code_challenge is the SHA-256 base64url of code_verifier', () => {
    const pair = generatePkcePair();
    const expected = createHash('sha256')
      .update(pair.code_verifier)
      .digest('base64url');
    expect(pair.code_challenge).toBe(expected);
  });

  it('returns different pairs on each call', () => {
    const p1 = generatePkcePair();
    const p2 = generatePkcePair();
    expect(p1.code_verifier).not.toBe(p2.code_verifier);
    expect(p1.code_challenge).not.toBe(p2.code_challenge);
  });
});

describe('verifyState', () => {
  it('returns true for matching states', () => {
    const state = generateState();
    expect(verifyState(state, state)).toBe(true);
  });

  it('returns false for non-matching states', () => {
    expect(verifyState('aaa', 'bbb')).toBe(false);
  });

  it('returns false for different-length states', () => {
    expect(verifyState('short', 'muchlonger')).toBe(false);
  });

  it('constant-time-ish: same-length wrong states don\'t reveal position', () => {
    // Just verify it returns false for one-char-different states
    const s1 = 'aaaa';
    const s2 = 'aaab';
    expect(verifyState(s1, s2)).toBe(false);
  });
});
