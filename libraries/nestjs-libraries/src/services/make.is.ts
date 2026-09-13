// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/services/make.is.ts
// NetAmplify id/secret helpers — pure utility functions used by platform
// providers and repositories. Replaces postiz's helper of the same name
// (kept the same export surface so existing providers keep working).

import { createHash, randomBytes } from 'crypto';

/**
 * Generate a short random ID — uses 9 random bytes (72 bits) base64url-encoded
 * to ~12 chars. Suitable for use as a public id, slug suffix, or nonce.
 */
export function makeId(length = 12): string {
  // length chars in base64url requires ~length*3/4 bytes
  const bytes = Math.ceil((length * 3) / 4);
  return randomBytes(bytes).toString('base64url').slice(0, length);
}

/**
 * Generate a long random secret — uses 32 bytes (256 bits) base64url-encoded
 * to ~43 chars. Suitable for use as an OAuth state, code_verifier, or
 * session secret.
 */
export function makeSecret(length = 43): string {
  const bytes = Math.ceil((length * 3) / 4);
  return randomBytes(bytes).toString('base64url').slice(0, length);
}

/**
 * Hash a string with SHA-256 (used for OAuth code_challenge S256 and
 * other verification contexts).
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

/**
 * Constant-time string comparison — used to compare OAuth state tokens,
 * webhook signatures, and other security-sensitive values. Avoids
 * timing-attack leakage.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
