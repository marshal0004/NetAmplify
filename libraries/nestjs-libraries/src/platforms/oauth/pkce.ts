// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/oauth/pkce.ts
// NetAmplify — PKCE (Proof Key for Code Exchange) helpers.
//
// Per docs/02-SRS.md FR-005: "OAuth 2.0 + PKCE (S256), random state stored in
// signed short-lived cookie, validated on callback."
//
// PKCE prevents the authorization-code interception attack — even if an
// attacker steals the code, they can't exchange it without the code_verifier
// (which never leaves the server).
//
// These functions are pure (no I/O, no Date.now/random — well, random IS
// used, that's the whole point). They are unit-tested in pkce.test.ts.

import { createHash, randomBytes } from 'crypto';

/**
 * The 96-bit nonce (12 bytes) used as state parameter. Base64url-encoded.
 */
export function generateState(length = 16): string {
  return randomBytes(length).toString('base64url');
}

/**
 * Generate a PKCE pair:
 *   - code_verifier: 32 random bytes base64url-encoded (~43 chars)
 *   - code_challenge: SHA-256(code_verifier) base64url-encoded (~43 chars)
 *   - code_challenge_method: 'S256' (the only method NetAmplify accepts)
 *
 * The verifier is stored in the signed state cookie; the challenge is sent
 * to the platform. On callback, the server re-computes SHA-256(verifier)
 * and compares it to the challenge stored by the platform.
 *
 * Returns the pair; the caller is responsible for storing the verifier
 * securely (signed httpOnly cookie, 10-min TTL, single-use).
 */
export function generatePkcePair(): {
  code_verifier: string;
  code_challenge: string;
  code_challenge_method: 'S256';
} {
  const code_verifier = randomBytes(32).toString('base64url');
  const code_challenge = createHash('sha256')
    .update(code_verifier)
    .digest('base64url');
  return {
    code_verifier,
    code_challenge,
    code_challenge_method: 'S256',
  };
}

/**
 * Verify a returned state matches the stored state. Constant-time comparison
 * to prevent timing attacks.
 */
export function verifyState(returnedState: string, storedState: string): boolean {
  if (returnedState.length !== storedState.length) return false;
  let diff = 0;
  for (let i = 0; i < returnedState.length; i++) {
    diff |= returnedState.charCodeAt(i) ^ storedState.charCodeAt(i);
  }
  return diff === 0;
}
