// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/services/vault/token-vault.ts
// NetAmplify — TokenVault (security-critical).
//
// AES-256-GCM encryption at rest. Key loaded from env.TOKEN_ENCRYPTION_KEY
// (32-byte base64 string; never in DB, never logged).
//
// Per docs/02-SRS.md FR-009:
//   "All credential shapes (OAuth tokens, API keys, webhook URLs, bot tokens,
//    app passwords) stored as ONE encrypted JSON blob per Connection
//    (credentialsCipher). Plaintext exists only in-memory inside server
//    workers/adapters. Never in logs, responses, or client bundles."
//
// Per docs/07-SECURITY-ACCESS.md:
//   "Decrypt happens exclusively inside TokenVault consumers."
//
// This service is the only place in the codebase that performs crypto.
// All other code MUST go through encrypt()/decrypt().

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'crypto';
import { Injectable, Inject } from '@nestjs/common';

/**
 * VaultKeyMissingError — thrown at inject-time if the env key is malformed.
 * This is a fail-fast: app should not boot with a bad key.
 */
export class VaultKeyMissingError extends Error {
  constructor(details: string) {
    super(
      `TokenVault: TOKEN_ENCRYPTION_KEY is invalid. ${details}. ` +
        `Generate a new one with: openssl rand -base64 32`
    );
    this.name = 'VaultKeyMissingError';
  }
}

/**
 * VaultTamperError — thrown by decrypt() when the ciphertext is invalid,
 * the IV/auth tag is corrupted, or the key is wrong. Indicates either
 * data corruption or active tampering.
 */
export class VaultTamperError extends Error {
  constructor(reason: string) {
    super(`TokenVault: ciphertext is corrupt or key is wrong — ${reason}`);
    this.name = 'VaultTamperError';
  }
}

/**
 * Encoding: base64 string.
 *
 * Ciphertext layout (all base64-encoded, dot-separated):
 *   <iv>.<authTag>.<ciphertext>
 *
 * - iv: 12 random bytes (96-bit nonce, GCM standard)
 * - authTag: 16 bytes (GCM authentication tag, verifies integrity + authenticity)
 * - ciphertext: variable length (matches plaintext length)
 *
 * Every encrypt() call uses a fresh IV, so the same plaintext encrypts to
 * a different ciphertext each time. The auth tag makes the ciphertext
 * tamper-evident — any modification to iv/authTag/ciphertext causes
 * decrypt() to throw VaultTamperError.
 */
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16; // GCM standard
const KEY_LENGTH = 32; // AES-256

function deriveKey(rawKey: string): Buffer {
  // Accept either a 32-byte base64 string (44 chars including padding) OR
  // a 64-char hex string. Convert to a 32-byte Buffer.
  const trimmed = rawKey.trim();

  // Try base64 first (postiz's recommended shape per docs/03-ARCHITECTURE.md)
  if (/^[A-Za-z0-9+/]{43}=?$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === KEY_LENGTH) return buf;
  }

  // Try hex (64 chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // Fallback: SHA-256 of the key (so any string ≥32 chars works as a key)
  if (trimmed.length >= 32) {
    return createHash('sha256').update(trimmed).digest();
  }

  throw new VaultKeyMissingError(
    `Key must be 32 bytes (base64-encoded as ~44 chars or hex as 64 chars) ` +
      `or any passphrase ≥32 chars. Got ${trimmed.length} chars.`
  );
}

@Injectable()
export class TokenVault {
  private readonly key: Buffer;

  constructor() {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!rawKey || rawKey.trim() === '') {
      throw new VaultKeyMissingError(
        'TOKEN_ENCRYPTION_KEY env var is missing or empty.'
      );
    }
    this.key = deriveKey(rawKey);
  }

  /**
   * For tests + advanced use: construct with an explicit key Buffer
   * (skips env lookup). Production code uses the @Injectable() default
   * constructor.
   */
  static withKey(key: Buffer): TokenVault {
    if (key.length !== KEY_LENGTH) {
      throw new VaultKeyMissingError(
        `Key must be exactly ${KEY_LENGTH} bytes; got ${key.length}.`
      );
    }
    const vault = Object.create(TokenVault.prototype);
    Object.defineProperty(vault, 'key', {
      value: key,
      writable: false,
      enumerable: false,
      configurable: false,
    });
    return vault as TokenVault;
  }

  /**
   * Encrypt an arbitrary JSON-serializable value (OAuth token object,
   * API key string, webhook URL, bot token, app password, etc.).
   * Returns base64-encoded "<iv>.<authTag>.<ciphertext>".
   */
  encrypt(plaintext: unknown): string {
    const json = JSON.stringify(plaintext);
    const buf = Buffer.from(json, 'utf8');

    const iv = randomBytes(IV_LENGTH);
    const cipher: CipherGCM = createCipheriv('aes-256-gcm', this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [iv, authTag, encrypted]
      .map((b) => b.toString('base64'))
      .join('.');
  }

  /**
   * Decrypt a ciphertext produced by encrypt(). Returns the original
   * value (typed as `unknown` — caller is responsible for narrowing).
   *
   * Throws VaultTamperError if the ciphertext is malformed, the IV/authTag
   * is corrupted, or the key is wrong. NEVER swallow this error silently
   * — it indicates either data corruption or active tampering.
   */
  decrypt(ciphertext: string): unknown {
    if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
      throw new VaultTamperError('ciphertext is empty or not a string');
    }

    const parts = ciphertext.split('.');
    if (parts.length !== 3) {
      throw new VaultTamperError(
        `expected 3 parts separated by ".", got ${parts.length}`
      );
    }

    let iv: Buffer;
    let authTag: Buffer;
    let encrypted: Buffer;
    try {
      iv = Buffer.from(parts[0], 'base64');
      authTag = Buffer.from(parts[1], 'base64');
      encrypted = Buffer.from(parts[2], 'base64');
    } catch {
      throw new VaultTamperError('failed to base64-decode parts');
    }

    if (iv.length !== IV_LENGTH) {
      throw new VaultTamperError(
        `iv must be ${IV_LENGTH} bytes, got ${iv.length}`
      );
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new VaultTamperError(
        `authTag must be ${AUTH_TAG_LENGTH} bytes, got ${authTag.length}`
      );
    }

    const decipher: DecipherGCM = createDecipheriv(
      'aes-256-gcm',
      this.key,
      iv,
      { authTagLength: AUTH_TAG_LENGTH }
    );
    decipher.setAuthTag(authTag);

    let decrypted: Buffer;
    try {
      decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
    } catch (e) {
      // GCM final() throws if auth tag verification fails. This is the
      // tamper-detection point — wrong key, modified ciphertext, etc.
      throw new VaultTamperError(
        `AES-GCM authentication failed: ${(e as Error).message}`
      );
    }

    try {
      return JSON.parse(decrypted.toString('utf8'));
    } catch (e) {
      throw new VaultTamperError(
        `decrypted bytes are not valid JSON: ${(e as Error).message}`
      );
    }
  }

  /**
   * Convenience: encrypt + decrypt round-trip check (used by tests + smoke).
   * Returns true iff decrypt(encrypt(x)) deep-equals x.
   */
  roundTrip(value: unknown): boolean {
    const cipher = this.encrypt(value);
    const back = this.decrypt(cipher);
    try {
      return JSON.stringify(back) === JSON.stringify(value);
    } catch {
      return false;
    }
  }
}
