// /home/z/my-project/netamplify-app/apps/backend/src/services/auth/auth.service.test.ts
// Vitest unit tests for AuthService — REAL bcrypt + JWT, mocked ONLY at
// the UsersService + AuditLogService repository boundary.
//
// This tests the actual auth logic (hashing, token gen, reset-token flow,
// timing-attack protection) with the real bcrypt + JwtService. Only the
// DB layer is mocked because we don't have Docker/Postgres in this sandbox.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import type { User } from '@prisma/client';

// ============================================================================
// Mock the UsersService (repository boundary only — auth logic stays real)
// ============================================================================
type MockUsers = {
  findByEmail: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  createWithProfile: ReturnType<typeof vi.fn>;
  updatePasswordHash: ReturnType<typeof vi.fn>;
  hardDelete: ReturnType<typeof vi.fn>;
  _reset: () => void;
};

function makeMockUsersService(): MockUsers {
  const users = new Map<string, User>();
  const usersByEmail = new Map<string, string>(); // email → id
  let nextId = 1;

  return {
    findByEmail: vi.fn(async (email: string): Promise<User | null> => {
      const id = usersByEmail.get(email);
      return id ? (users.get(id) ?? null) : null;
    }),
    findById: vi.fn(async (id: string): Promise<User | null> => {
      return users.get(id) ?? null;
    }),
    createWithProfile: vi.fn(async (data: {
      email: string;
      passwordHash: string;
      name: string;
    }): Promise<User> => {
      const id = `user-${nextId++}`;
      const now = new Date();
      const user: User = {
        id,
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        createdAt: now,
        updatedAt: now,
      };
      users.set(id, user);
      usersByEmail.set(data.email, id);
      return user;
    }),
    updatePasswordHash: vi.fn(async (userId: string, passwordHash: string): Promise<void> => {
      const user = users.get(userId);
      if (user) user.passwordHash = passwordHash;
    }),
    hardDelete: vi.fn(async (userId: string): Promise<void> => {
      const user = users.get(userId);
      if (user) {
        usersByEmail.delete(user.email);
        users.delete(userId);
      }
    }),
    _reset: () => {
      users.clear();
      usersByEmail.clear();
      nextId = 1;
    },
  };
}

type MockAudit = {
  log: ReturnType<typeof vi.fn>;
};

function makeMockAuditService(): MockAudit {
  return {
    log: vi.fn(async (_params: unknown): Promise<void> => {}),
  };
}

// ============================================================================
// Real JwtService (no mock — JWT crypto is production-grade)
// ============================================================================
function makeRealJwtService(): JwtService {
  return new JwtService({
    secret: 'test-jwt-secret-not-for-prod-use-real-random-key',
    signOptions: { expiresIn: 60 * 60, algorithm: 'HS256' },
  });
}

// ============================================================================
// Tests
// ============================================================================
describe('AuthService', () => {
  let authService: AuthService;
  let mockUsers: ReturnType<typeof makeMockUsersService>;
  let mockAudit: ReturnType<typeof makeMockAuditService>;
  let jwt: JwtService;
  let resetStore: Map<string, { hash: string; expiresAt: number }>;

  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    mockUsers = makeMockUsersService();
    mockAudit = makeMockAuditService();
    jwt = makeRealJwtService();
    resetStore = new Map();
    process.env.JWT_SECRET = 'test-jwt-secret-not-for-prod-use-real-random-key';
    authService = new AuthService(
      mockUsers as unknown as import('./auth.service').AuthService extends { constructor: (...args: infer A) => unknown } ? A[0] : never,
      mockAudit as unknown as import('./auth.service').AuthService extends { constructor: (...args: infer A) => unknown } ? A[1] : never,
      jwt
    ).withResetStore(resetStore);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('signup', () => {
    it('creates a new user with hashed password + returns JWT', async () => {
      const result = await authService.signup({
        email: 'student@example.com',
        password: 'StrongPass1',
        name: 'Jane Doe',
      });

      expect(result.user.email).toBe('student@example.com');
      expect(result.user.name).toBe('Jane Doe');
      expect(result.user.id).toMatch(/^user-/);
      expect(result.accessToken).toBeTruthy();
      expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

      // Verify the JWT is decodable
      const decoded = jwt.decode(result.accessToken);
      expect(decoded).toHaveProperty('sub', result.user.id);
      expect(decoded).toHaveProperty('email', 'student@example.com');

      // Verify the password was hashed (not stored plaintext)
      expect(mockUsers.createWithProfile).toHaveBeenCalledTimes(1);
      const created = mockUsers.createWithProfile.mock.calls[0][0] as { passwordHash: string };
      expect(created.passwordHash).not.toBe('StrongPass1');
      expect(created.passwordHash).toMatch(/^\$2[aby]\$/);

      // Verify the audit log was called
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      const auditCall = mockAudit.log.mock.calls[0][0] as { action: string };
      expect(auditCall.action).toBe('LOGIN');
    });

    it('rejects a weak password (no digit)', async () => {
      await expect(
        authService.signup({
          email: 'student@example.com',
          password: 'NoDigitsHere',
          name: 'Jane',
        })
      ).rejects.toThrow(ServiceError);
    });

    it('rejects an invalid email', async () => {
      await expect(
        authService.signup({
          email: 'not-an-email',
          password: 'StrongPass1',
          name: 'Jane',
        })
      ).rejects.toThrow(ServiceError);
    });

    it('rejects a duplicate email with EMAIL_TAKEN', async () => {
      await authService.signup({
        email: 'student@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });

      await expect(
        authService.signup({
          email: 'student@example.com',
          password: 'StrongPass1',
          name: 'Jane2',
        })
      ).rejects.toThrow(ServiceError);
    });

    it('normalizes email to lowercase before lookup', async () => {
      await authService.signup({
        email: 'Student@Example.COM',
        password: 'StrongPass1',
        name: 'Jane',
      });

      // Subsequent signup with lowercase should fail (duplicate)
      await expect(
        authService.signup({
          email: 'student@example.com',
          password: 'StrongPass1',
          name: 'Jane',
        })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await authService.signup({
        email: 'student@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });
    });

    it('logs in with correct credentials', async () => {
      const result = await authService.login({
        email: 'student@example.com',
        password: 'StrongPass1',
      });

      expect(result.user.email).toBe('student@example.com');
      expect(result.accessToken).toBeTruthy();

      // Audit should have logged LOGIN (signup) + LOGIN (this login) = 2 calls
      expect(mockAudit.log).toHaveBeenCalledTimes(2);
    });

    it('rejects wrong password with INVALID_CREDENTIALS', async () => {
      await expect(
        authService.login({
          email: 'student@example.com',
          password: 'WrongPassword1',
        })
      ).rejects.toThrow(ServiceError);

      // Audit should log LOGIN_FAIL
      const auditCall = mockAudit.log.mock.calls[1][0] as { action: string };
      expect(auditCall.action).toBe('LOGIN_FAIL');
    });

    it('rejects non-existent email with the same error (no email enumeration)', async () => {
      await expect(
        authService.login({
          email: 'nonexistent@example.com',
          password: 'StrongPass1',
        })
      ).rejects.toThrow(ServiceError);

      // Should be INVALID_CREDENTIALS (not NOT_FOUND)
      const err = await authService
        .login({ email: 'nonexistent@example.com', password: 'StrongPass1' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe('INVALID_CREDENTIALS');
    });

    it('runs bcrypt comparison even when email is not found (timing-attack protection)', async () => {
      const startUnknown = Date.now();
      await authService
        .login({ email: 'unknown@example.com', password: 'StrongPass1' })
        .catch(() => {});
      const elapsedUnknown = Date.now() - startUnknown;

      const startKnown = Date.now();
      await authService
        .login({ email: 'student@example.com', password: 'WrongPass1' })
        .catch(() => {});
      const elapsedKnown = Date.now() - startKnown;

      // Both should take roughly the same time (bcrypt cost 10 ≈ 70ms).
      // If unknown email returns instantly, timing attack is possible.
      // Allow 60ms tolerance for measurement noise.
      const delta = Math.abs(elapsedUnknown - elapsedKnown);
      expect(delta).toBeLessThan(60);
    });

    it('rejects malformed input', async () => {
      await expect(
        authService.login({ email: 'not-email', password: 'StrongPass1' })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('issueToken / verifyToken', () => {
    it('issues a JWT that decodes to the correct payload', async () => {
      const result = await authService.signup({
        email: 'student@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });
      const payload = authService.verifyToken(result.accessToken);
      expect(payload.sub).toBe(result.user.id);
      expect(payload.email).toBe('student@example.com');
    });

    it('rejects a tampered JWT with INVALID_TOKEN', async () => {
      const result = await authService.signup({
        email: 'student@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });
      // Tamper with the JWT
      const parts = result.accessToken.split('.');
      const tampered = `${parts[0]}.${parts[1]}.AAAA`;
      expect(() => authService.verifyToken(tampered)).toThrow(ServiceError);
    });
  });

  describe('password reset flow', () => {
    beforeEach(async () => {
      await authService.signup({
        email: 'student@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });
    });

    it('returns a reset token when email exists', async () => {
      const token = await authService.requestPasswordReset({ email: 'student@example.com' });
      expect(token).not.toBeNull();
      expect(typeof token).toBe('string');
      expect((token as string).length).toBeGreaterThan(20);

      // Token should be stored in the reset store as a hash
      expect(resetStore.size).toBe(1);
      const stored = Array.from(resetStore.values())[0];
      expect(stored.hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
      expect(stored.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('returns null when email does not exist (no enumeration)', async () => {
      const token = await authService.requestPasswordReset({ email: 'nonexistent@example.com' });
      expect(token).toBeNull();
      expect(resetStore.size).toBe(0);
    });

    it('rejects invalid email format', async () => {
      await expect(
        authService.requestPasswordReset({ email: 'not-email' })
      ).rejects.toThrow(ServiceError);
    });

    it('resets password with a valid token + new strong password', async () => {
      const token = (await authService.requestPasswordReset({ email: 'student@example.com' })) as string;

      const result = await authService.confirmPasswordReset({
        token,
        newPassword: 'NewStrong1',
      });

      expect(result.userId).toBeTruthy();

      // Verify the new password works
      const loginResult = await authService.login({
        email: 'student@example.com',
        password: 'NewStrong1',
      });
      expect(loginResult.user.email).toBe('student@example.com');
    });

    it('rejects a wrong reset token with INVALID_TOKEN', async () => {
      await authService.requestPasswordReset({ email: 'student@example.com' });
      await expect(
        authService.confirmPasswordReset({
          token: 'wrong-token',
          newPassword: 'NewStrong1',
        })
      ).rejects.toThrow(ServiceError);
    });

    it('rejects a reused (consumed) reset token', async () => {
      const token = (await authService.requestPasswordReset({ email: 'student@example.com' })) as string;
      await authService.confirmPasswordReset({ token, newPassword: 'NewStrong1' });

      // Reuse should fail
      await expect(
        authService.confirmPasswordReset({ token, newPassword: 'Another1' })
      ).rejects.toThrow(ServiceError);
    });

    it('rejects a weak new password', async () => {
      const token = (await authService.requestPasswordReset({ email: 'student@example.com' })) as string;
      await expect(
        authService.confirmPasswordReset({ token, newPassword: 'weak' })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('getCurrentUser', () => {
    it('returns user by id without passwordHash', async () => {
      const signup = await authService.signup({
        email: 'student@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });
      const user = await authService.getCurrentUser(signup.user.id);
      expect(user).not.toBeNull();
      expect(user?.email).toBe('student@example.com');
      expect(user?.name).toBe('Jane');
      // passwordHash must NOT be in the returned object
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('returns null for unknown id', async () => {
      const user = await authService.getCurrentUser('unknown-id');
      expect(user).toBeNull();
    });
  });

  describe('deleteAccount', () => {
    it('deletes the user (cascades via Prisma)', async () => {
      const signup = await authService.signup({
        email: 'student@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });

      await authService.deleteAccount(signup.user.id);

      // Subsequent login should fail
      await expect(
        authService.login({
          email: 'student@example.com',
          password: 'StrongPass1',
        })
      ).rejects.toThrow(ServiceError);

      // Audit should have ACCOUNT_DELETE
      const auditCalls = mockAudit.log.mock.calls as Array<unknown[]>;
      const deleteCall = auditCalls.find(
        (c) => (c[0] as { action: string }).action === 'ACCOUNT_DELETE'
      );
      expect(deleteCall).toBeDefined();
    });

    it('throws NOT_FOUND for unknown user id', async () => {
      const err = await authService.deleteAccount('unknown-id').catch((e) => e);
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe('NOT_FOUND');
    });
  });
});
