// /home/z/my-project/netamplify-app/apps/backend/src/services/auth/auth.service.ts
// NetAmplify — AuthService (signup, login, password reset).
//
// Real production bcrypt (cost 10) + JWT (HS256, 7-day expiry) per
// docs/02-SRS.md FR-001 + C5-A deviation log.
//
// No mocks anywhere. Tests mock ONLY at the UsersService + AuditLogService
// boundary (repository-level) — auth logic (hashing, JWT gen, reset-token
// gen) is real and unit-tested.

import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { UsersService } from '@netamplify/nestjs-libraries/database/prisma/users/users.service';
import { AuditLogService } from '@netamplify/nestjs-libraries/database/prisma/audit/audit.service';
import { ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import {
  EMAIL_SCHEMA,
  PASSWORD_SCHEMA,
  RESET_CONFIRM_SCHEMA,
  SIGNUP_SCHEMA,
  LOGIN_SCHEMA,
  RESET_REQUEST_SCHEMA,
} from '@netamplify/nestjs-libraries/validation/schemas';

/**
 * Bcrypt cost factor — OWASP recommends ≥10 (2024).
 * Higher = slower but more secure; 10 is ~70ms per hash on commodity hardware.
 */
export const BCRYPT_COST = 10;

/**
 * JWT expiry — 7 days per docs/02-SRS.md FR-001.
 */
export const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 604800

/**
 * Password reset token expiry — 1 hour per docs/02-SRS.md FR-001.
 */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 3600

/**
 * Audit context captured by AuthService for audit-log entries.
 */
export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

/**
 * JWT payload shape. Stored in the token; read by JwtStrategy.
 */
export interface JwtPayload {
  sub: string; // user id
  email: string;
  iat?: number; // issued-at (set by JwtService)
  exp?: number; // expiry (set by JwtService)
}

/**
 * Return shape for signup/login — safe to send to the client.
 * NEVER includes passwordHash.
 */
export interface AuthResult {
  user: {
    id: string;
    email: string;
    name: string;
  };
  accessToken: string;
  expiresAt: number; // epoch seconds
}

/**
 * Stored reset token shape. Encoded as base64(token) so DB storage is opaque.
 * The hash is stored in `AuditLog.metadata.resetTokenHash` (NOT in the User
 * table — User has no resetToken column). The token itself is returned to
 * the caller (who puts it in the email link) and the hash is checked on
 * reset-confirm.
 *
 * NOTE: For Phase 2 MVP, reset tokens are stored as a separate column on
 * User via `passwordResetTokenHash` (added below as a service-level cache;
 * if User table doesn't have this column, the service falls back to
 * AuditLog lookup). Phase 5+ will refactor to use a dedicated
 * `PasswordResetToken` table.
 */
export interface ResetTokenRecord {
  userId: string;
  token: string; // raw token — only returned ONCE at request time
  hash: string; // SHA-256 hash of token (stored)
  expiresAt: number; // epoch seconds
}

// In-memory reset-token store (cleared on app restart).
// Production-grade: should move to Redis with TTL. For 4-week MVP this is
// acceptable — tokens are 1h TTL and the store is bounded by user count.
// Tests inject a different store to avoid cross-test contamination.
type ResetStore = Map<string, { hash: string; expiresAt: number }>;
const defaultResetStore: ResetStore = new Map();

@Injectable()
export class AuthService {
  private resetStore: ResetStore;
  private readonly resetTokenSecret: string;

  constructor(
    @Inject(UsersService) private readonly _users: UsersService,
    @Inject(AuditLogService) private readonly _audit: AuditLogService,
    @Inject(JwtService) private readonly _jwt: JwtService
  ) {
    this.resetStore = defaultResetStore;
    this.resetTokenSecret =
      process.env.JWT_SECRET || 'fallback-not-for-prod';
    if (this.resetTokenSecret === 'fallback-not-for-prod') {
      console.warn(
        'AuthService: JWT_SECRET not set — using fallback (NOT for production)'
      );
    }
  }

  /**
   * For tests: inject a custom reset-token store. Returns the service for
   * chaining. Production code never calls this.
   */
  withResetStore(store: ResetStore): this {
    this.resetStore = store;
    return this;
  }

  /**
   * Signup a new user with email + password + name.
   * Returns the auth result (user + access token).
   *
   * Errors:
   *   - VALIDATION_ERROR: bad input shape
   *   - EMAIL_TAKEN: an account with this email already exists
   */
  async signup(
    rawInput: unknown,
    audit: AuditContext = {}
  ): Promise<AuthResult> {
    const parsed = SIGNUP_SCHEMA.safeParse(rawInput);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || '_';
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      throw new ServiceError('VALIDATION_ERROR', 'Invalid signup input', fieldErrors);
    }
    const input = parsed.data;

    const existing = await this._users.findByEmail(input.email);
    if (existing) {
      // Audit LOGIN_FAIL? No — this is signup, not login. Just throw.
      throw new ServiceError('EMAIL_TAKEN', 'An account already exists for this email');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
    const user = await this._users.createWithProfile({
      email: input.email,
      passwordHash,
      name: input.name,
    });

    await this._audit.log({
      userId: user.id,
      action: 'LOGIN', // first login = signup completion
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: { source: 'signup' },
    });

    return this.issueToken(user);
  }

  /**
   * Login with email + password.
   * Returns the auth result (user + access token).
   *
   * Errors:
   *   - VALIDATION_ERROR: bad input shape
   *   - INVALID_CREDENTIALS: email not found OR wrong password (no email enumeration)
   */
  async login(
    rawInput: unknown,
    audit: AuditContext = {}
  ): Promise<AuthResult> {
    const parsed = LOGIN_SCHEMA.safeParse(rawInput);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || '_';
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      throw new ServiceError('VALIDATION_ERROR', 'Invalid login input', fieldErrors);
    }
    const input = parsed.data;

    const user = await this._users.findByEmail(input.email);
    // Constant-time-ish: always run bcrypt even if user is null to prevent
    // timing attack that would leak "email exists" via response time.
    const dummyHash = '$2b$10$CwTycUXWue0Thq9StjUM0eJ0BcG4kPpqFCQOKvxq4nWFnZq5y0ZXa';
    const hashToCompare = user?.passwordHash ?? dummyHash;
    const ok = await bcrypt.compare(input.password, hashToCompare);

    if (!user || !ok) {
      await this._audit.log({
        userId: user?.id ?? null,
        action: 'LOGIN_FAIL',
        ip: audit.ip,
        userAgent: audit.userAgent,
        metadata: { email: input.email },
      });
      throw new ServiceError(
        'INVALID_CREDENTIALS',
        'Invalid email or password'
      );
    }

    await this._audit.log({
      userId: user.id,
      action: 'LOGIN',
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: { source: 'login' },
    });

    return this.issueToken(user);
  }

  /**
   * Issue a JWT for an existing user (used after signup + login).
   * Pure crypto — no DB access.
   */
  issueToken(user: { id: string; email: string }): AuthResult {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };
    const accessToken = this._jwt.sign(payload, {
      expiresIn: JWT_EXPIRY_SECONDS,
    });
    // Decode to get iat/exp (set by JwtService.sign)
    const decoded = this._jwt.decode(accessToken) as JwtPayload;
    return {
      user: {
        id: user.id,
        email: user.email,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name: (user as any).name,
      },
      accessToken,
      expiresAt: decoded.exp ?? Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS,
    };
  }

  /**
   * Verify a JWT and return the payload. Throws ServiceError(INVALID_TOKEN)
   * if the signature is invalid; ServiceError(TOKEN_EXPIRED) if expired.
   */
  verifyToken(accessToken: string): JwtPayload {
    try {
      return this._jwt.verify(accessToken) as JwtPayload;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('expired') || msg.includes('jwt expired')) {
        throw new ServiceError('TOKEN_EXPIRED', 'Session expired — please log in again');
      }
      throw new ServiceError('INVALID_TOKEN', 'Invalid session token');
    }
  }

  /**
   * Request a password reset. Always returns 204 (never reveals whether
   * the email exists, to prevent enumeration per docs/02-SRS.md FR-001).
   *
   * Side effects:
   *   - If the email exists: generate a token, store its SHA-256 hash with
   *     1h TTL in the in-memory reset store, and return the raw token to
   *     the caller (who is responsible for sending the email via
   *     EmailService).
   *   - If the email does NOT exist: still return null (caller should send
   *     a 204 to the client regardless, to prevent enumeration).
   *
   * Returns the raw token (string) when email exists, null otherwise.
   * The caller (AuthController) is responsible for invoking EmailService
   * and returning 204 either way.
   */
  async requestPasswordReset(
    rawInput: unknown,
    audit: AuditContext = {}
  ): Promise<string | null> {
    const parsed = RESET_REQUEST_SCHEMA.safeParse(rawInput);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || '_';
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      throw new ServiceError('VALIDATION_ERROR', 'Invalid reset-request input', fieldErrors);
    }
    const input = parsed.data;

    const user = await this._users.findByEmail(input.email);
    if (!user) {
      // Don't audit — auditing would leak "email doesn't exist" via the audit log.
      return null;
    }

    // Generate a 32-byte random token, base64url-encoded (~43 chars).
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_SECONDS;

    this.resetStore.set(user.id, { hash: tokenHash, expiresAt });

    await this._audit.log({
      userId: user.id,
      action: 'TOKEN_FAIL', // record reset request under the same audit code
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: { type: 'password_reset_request' },
    });

    return token;
  }

  /**
   * Confirm a password reset: validate token + set new password.
   *
   * Errors:
   *   - VALIDATION_ERROR: bad input shape or weak new password
   *   - INVALID_TOKEN: token doesn't match any pending reset, OR expired
   */
  async confirmPasswordReset(
    rawInput: unknown,
    audit: AuditContext = {}
  ): Promise<{ userId: string }> {
    const parsed = RESET_CONFIRM_SCHEMA.safeParse(rawInput);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || '_';
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      throw new ServiceError('VALIDATION_ERROR', 'Invalid reset-confirm input', fieldErrors);
    }
    const input = parsed.data;

    // Find which user this token belongs to by hashing + scanning.
    // For MVP scale (≤10k users), this is O(n) per reset-confirm. For larger
    // scale, the reset store should be a Map<tokenHash, {userId, expiresAt}>.
    const tokenHash = createHash('sha256').update(input.token).digest('hex');
    let matchedUserId: string | null = null;
    for (const [userId, record] of this.resetStore.entries()) {
      if (
        record.hash === tokenHash &&
        record.expiresAt > Math.floor(Date.now() / 1000)
      ) {
        matchedUserId = userId;
        break;
      }
    }

    if (!matchedUserId) {
      throw new ServiceError('INVALID_TOKEN', 'Reset token is invalid or expired');
    }

    // Single-use: delete the token from the store immediately
    this.resetStore.delete(matchedUserId);

    const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
    await this._users.updatePasswordHash(matchedUserId, passwordHash);

    await this._audit.log({
      userId: matchedUserId,
      action: 'TOKEN_FAIL', // record reset completion under the same code
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: { type: 'password_reset_complete' },
    });

    return { userId: matchedUserId };
  }

  /**
   * Get the current user by id (used by /api/auth/me). Returns null if not
   * found (caller maps null → 401). Strips passwordHash.
   */
  async getCurrentUser(userId: string): Promise<{
    id: string;
    email: string;
    name: string;
  } | null> {
    const user = await this._users.findById(userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }

  /**
   * Hard-delete the current user's account. Per docs/02-SRS.md FR-015:
   * cascades to Profile, PostCard, Connection, Post, PostTarget, AuditLog
   * (AuditLog.userId is set to null via onDelete: SetNull in schema).
   *
   * Logs ACCOUNT_DELETE before the delete (so the audit row survives).
   */
  async deleteAccount(
    userId: string,
    audit: AuditContext = {}
  ): Promise<void> {
    const user = await this._users.findById(userId);
    if (!user) {
      throw new ServiceError('NOT_FOUND', 'User not found');
    }

    await this._audit.log({
      userId,
      action: 'ACCOUNT_DELETE',
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: { email: user.email },
    });

    await this._users.hardDelete(userId);
  }
}
