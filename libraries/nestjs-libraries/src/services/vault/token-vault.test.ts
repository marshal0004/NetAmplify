// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/services/vault/token-vault.test.ts
// Vitest unit tests for TokenVault — real AES-256-GCM crypto, NO mocks.
//
// Coverage targets per docs/09-TESTING-STRATEGY.md:
//   - round-trip encrypt/decrypt ✓
//   - tampered ciphertext throws ✓
//   - ciphertext ≠ plaintext (assert) ✓
//   - wrong key fails cleanly ✓

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import {
  TokenVault,
  VaultKeyMissingError,
  VaultTamperError,
} from './token-vault';

describe('TokenVault', () => {
  const VALID_KEY = randomBytes(32).toString('base64');
  const originalEnvKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    if (originalEnvKey === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = originalEnvKey;
    }
  });

  describe('constructor (env validation)', () => {
    it('boots with a valid base64 key from env', () => {
      const vault = new TokenVault();
      expect(vault).toBeInstanceOf(TokenVault);
    });

    it('throws VaultKeyMissingError when TOKEN_ENCRYPTION_KEY is missing', () => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      expect(() => new TokenVault()).toThrow(VaultKeyMissingError);
    });

    it('throws VaultKeyMissingError when TOKEN_ENCRYPTION_KEY is empty', () => {
      process.env.TOKEN_ENCRYPTION_KEY = '';
      expect(() => new TokenVault()).toThrow(VaultKeyMissingError);
    });

    it('throws VaultKeyMissingError when key is too short', () => {
      process.env.TOKEN_ENCRYPTION_KEY = 'short';
      expect(() => new TokenVault()).toThrow(VaultKeyMissingError);
    });

    it('accepts a 64-char hex key', () => {
      process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
      expect(() => new TokenVault()).not.toThrow();
    });

    it('accepts a ≥32-char passphrase (SHA-256 derived)', () => {
      process.env.TOKEN_ENCRYPTION_KEY = 'x'.repeat(40);
      expect(() => new TokenVault()).not.toThrow();
    });
  });

  describe('withKey (explicit key constructor)', () => {
    it('constructs with a 32-byte Buffer', () => {
      const vault = TokenVault.withKey(randomBytes(32));
      expect(vault).toBeInstanceOf(TokenVault);
    });

    it('throws if key is wrong length', () => {
      expect(() => TokenVault.withKey(randomBytes(16))).toThrow(VaultKeyMissingError);
      expect(() => TokenVault.withKey(randomBytes(64))).toThrow(VaultKeyMissingError);
    });
  });

  describe('encrypt → decrypt round-trip', () => {
    let vault: TokenVault;

    beforeEach(() => {
      vault = new TokenVault();
    });

    it('round-trips a simple string', () => {
      const input = 'hello world';
      const cipher = vault.encrypt(input);
      expect(typeof cipher).toBe('string');
      expect(cipher).not.toBe(input);
      expect(vault.decrypt(cipher)).toBe(input);
    });

    it('round-trips an OAuth token object', () => {
      const input = {
        accessToken: 'gho_16C7e42F292c6912E7710c538607E29GhZx',
        refreshToken: 'r/5_z-abc123def456',
        expiresAt: 1735200000000,
        scopes: ['identity', 'submit'],
      };
      const cipher = vault.encrypt(input);
      const back = vault.decrypt(cipher) as typeof input;
      expect(back).toEqual(input);
      expect(back.accessToken).toBe(input.accessToken);
      expect(back.scopes).toEqual(input.scopes);
    });

    it('round-trips a Discord webhook URL', () => {
      const input =
        'https://discord.com/api/webhooks/1234567890/abcdef-ghijkl-mnopqr';
      const cipher = vault.encrypt(input);
      expect(vault.decrypt(cipher)).toBe(input);
    });

    it('round-trips a Telegram bot token', () => {
      const input = '7812345678:AAH1234567890abcdefghijklmnopqrstuv';
      expect(vault.decrypt(vault.encrypt(input))).toBe(input);
    });

    it('round-trips a null value', () => {
      expect(vault.decrypt(vault.encrypt(null))).toBeNull();
    });

    it('round-trips a number', () => {
      expect(vault.decrypt(vault.encrypt(42))).toBe(42);
    });

    it('round-trips an empty array', () => {
      const input: unknown[] = [];
      expect(vault.decrypt(vault.encrypt(input))).toEqual([]);
    });

    it('round-trips a deeply nested object', () => {
      const input = {
        a: { b: { c: { d: ['e', 'f', { g: 'h' }] } } },
      };
      expect(vault.decrypt(vault.encrypt(input))).toEqual(input);
    });

    it('roundTrip() helper returns true for matching round-trip', () => {
      expect(vault.roundTrip({ test: 'value' })).toBe(true);
    });
  });

  describe('ciphertext ≠ plaintext (assert)', () => {
    let vault: TokenVault;
    beforeEach(() => {
      vault = new TokenVault();
    });

    it('ciphertext of "password123" is not "password123"', () => {
      const cipher = vault.encrypt('password123');
      expect(cipher).not.toBe('password123');
      expect(cipher).not.toContain('password123');
    });

    it('ciphertext of an OAuth token does not contain the token', () => {
      const token = 'gho_super_secret_token_xyz';
      const cipher = vault.encrypt({ accessToken: token });
      expect(cipher).not.toContain(token);
    });

    it('ciphertext is base64-encoded (iv.authTag.ciphertext)', () => {
      const cipher = vault.encrypt('test');
      expect(cipher).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    });

    it('same plaintext encrypts to different ciphertext (fresh IV each time)', () => {
      const cipher1 = vault.encrypt('same value');
      const cipher2 = vault.encrypt('same value');
      expect(cipher1).not.toBe(cipher2);
      // Both decrypt to the same value
      expect(vault.decrypt(cipher1)).toBe(vault.decrypt(cipher2));
    });
  });

  describe('tamper detection', () => {
    let vault: TokenVault;
    beforeEach(() => {
      vault = new TokenVault();
    });

    it('throws VaultTamperError on empty ciphertext', () => {
      expect(() => vault.decrypt('')).toThrow(VaultTamperError);
    });

    it('throws VaultTamperError on non-string ciphertext', () => {
      // @ts-expect-error — deliberately invalid
      expect(() => vault.decrypt(null)).toThrow(VaultTamperError);
      // @ts-expect-error — deliberately invalid
      expect(() => vault.decrypt(undefined)).toThrow(VaultTamperError);
    });

    it('throws VaultTamperError on malformed ciphertext (1 part)', () => {
      expect(() => vault.decrypt('garbage')).toThrow(VaultTamperError);
    });

    it('throws VaultTamperError on malformed ciphertext (2 parts)', () => {
      expect(() => vault.decrypt('a.b')).toThrow(VaultTamperError);
    });

    it('throws VaultTamperError on corrupted IV', () => {
      const cipher = vault.encrypt('value');
      const parts = cipher.split('.');
      // Corrupt the IV by appending junk
      parts[0] = parts[0] + 'XX==';
      const corrupted = parts.join('.');
      expect(() => vault.decrypt(corrupted)).toThrow(VaultTamperError);
    });

    it('throws VaultTamperError on corrupted auth tag', () => {
      const cipher = vault.encrypt('value');
      const parts = cipher.split('.');
      // Flip a bit in the auth tag — this should fail GCM verification
      const authBuf = Buffer.from(parts[1], 'base64');
      authBuf[0] ^= 0x01;
      parts[1] = authBuf.toString('base64');
      const corrupted = parts.join('.');
      expect(() => vault.decrypt(corrupted)).toThrow(VaultTamperError);
    });

    it('throws VaultTamperError on corrupted ciphertext body', () => {
      const cipher = vault.encrypt('value');
      const parts = cipher.split('.');
      // Flip a bit in the ciphertext body
      const bodyBuf = Buffer.from(parts[2], 'base64');
      bodyBuf[0] ^= 0x01;
      parts[2] = bodyBuf.toString('base64');
      const corrupted = parts.join('.');
      expect(() => vault.decrypt(corrupted)).toThrow(VaultTamperError);
    });

    it('throws VaultTamperError when decrypting with the wrong key', () => {
      const vault1 = new TokenVault();
      // Encrypt with the current key
      const cipher = vault1.encrypt('secret');
      // Reboot the vault with a different key
      process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
      const vault2 = new TokenVault();
      expect(() => vault2.decrypt(cipher)).toThrow(VaultTamperError);
    });
  });
});
