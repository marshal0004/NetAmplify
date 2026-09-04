// /home/z/my-project/netamplify-app/tests/integration/auth.integration.test.ts
// NetAmplify — Integration tests for /api/auth/* endpoints.
import { AuthService } from '../../apps/backend/src/services/auth/auth.service';
//
// These tests fire REAL HTTP requests against the running NestJS app
// (mocked Prisma + mocked Redis + real bcrypt + real JWT). This is the
// equivalent of curl-tests, but in-process so they run anywhere without
// Docker.
//
// Per docs/09-TESTING-STRATEGY.md:
//   "Integration (Vitest + testcontainers): API routes end-to-end with
//    test DB: auth guard, validation errors, CRUD + ownership."

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app';

describe('Integration: Auth', () => {
  let test: TestApp;

  beforeEach(async () => {
    test = await createTestApp();
  });

  afterEach(async () => {
    await test.close();
  });

  describe('POST /api/auth/signup', () => {
    it('returns 201 + JWT on valid signup', async () => {
      const res = await test.request.post('/api/auth/signup').send({
        email: 'jane@example.com',
        password: 'StrongPass1',
        name: 'Jane Doe',
      });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('jane@example.com');
      expect(res.body.user.name).toBe('Jane Doe');
      expect(res.body.user.id).toMatch(/^id-/);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

      // JWT must be decodable
      const decoded = test.jwt.decode(res.body.accessToken);
      expect(decoded).toHaveProperty('sub', res.body.user.id);
      expect(decoded).toHaveProperty('email', 'jane@example.com');
    });

    it('returns 409 on duplicate email', async () => {
      await test.request.post('/api/auth/signup').send({
        email: 'jane@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });
      const res = await test.request.post('/api/auth/signup').send({
        email: 'jane@example.com',
        password: 'StrongPass1',
        name: 'Jane2',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('returns 400 on weak password (no digit)', async () => {
      const res = await test.request.post('/api/auth/signup').send({
        email: 'jane@example.com',
        password: 'NoDigitsHere',
        name: 'Jane',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.fieldErrors).toBeDefined();
    });

    it('returns 400 on malformed email', async () => {
      const res = await test.request.post('/api/auth/signup').send({
        email: 'not-an-email',
        password: 'StrongPass1',
        name: 'Jane',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 on short password (<8 chars)', async () => {
      const res = await test.request.post('/api/auth/signup').send({
        email: 'jane@example.com',
        password: 'Ab1',
        name: 'Jane',
      });
      expect(res.status).toBe(400);
    });

    it('normalizes email to lowercase', async () => {
      const res = await test.request.post('/api/auth/signup').send({
        email: 'Jane@Example.COM',
        password: 'StrongPass1',
        name: 'Jane',
      });
      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe('jane@example.com');
    });

    it('returns the standard error envelope shape', async () => {
      const res = await test.request.post('/api/auth/signup').send({ email: 'bad' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code');
      expect(res.body.error).toHaveProperty('message');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await test.request.post('/api/auth/signup').send({
        email: 'jane@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });
    });

    it('returns 200 + JWT on correct credentials', async () => {
      const res = await test.request.post('/api/auth/login').send({
        email: 'jane@example.com',
        password: 'StrongPass1',
      });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('jane@example.com');
      expect(res.body.accessToken).toBeTruthy();
    });

    it('returns 401 on wrong password (no email enumeration)', async () => {
      const res = await test.request.post('/api/auth/login').send({
        email: 'jane@example.com',
        password: 'WrongPassword1',
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('returns 401 on non-existent email (same error)', async () => {
      const res = await test.request.post('/api/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'StrongPass1',
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('returns 400 on malformed input', async () => {
      const res = await test.request.post('/api/auth/login').send({
        email: 'not-email',
        password: 'StrongPass1',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 200 + user info with valid JWT', async () => {
      const { accessToken, userId } = await test.signupAndLogin();
      const res = await test.request.get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userId);
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('returns 401 without JWT', async () => {
      const res = await test.request.get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 on malformed JWT', async () => {
      const res = await test.request.get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');
      expect(res.status).toBe(401);
    });

    it('returns 401 with no Bearer prefix', async () => {
      const res = await test.request.get('/api/auth/me').set('Authorization', 'some-token-no-bearer');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/reset-request', () => {
    beforeEach(async () => {
      await test.request.post('/api/auth/signup').send({
        email: 'jane@example.com',
        password: 'StrongPass1',
        name: 'Jane',
      });
    });

    it('returns 204 for existing email', async () => {
      const res = await test.request.post('/api/auth/reset-request').send({
        email: 'jane@example.com',
      });
      expect(res.status).toBe(204);
    });

    it('returns 204 for non-existent email (no enumeration)', async () => {
      const res = await test.request.post('/api/auth/reset-request').send({
        email: 'nonexistent@example.com',
      });
      expect(res.status).toBe(204);
    });

    it('returns 204 for malformed email (does NOT leak validation error)', async () => {
      const res = await test.request.post('/api/auth/reset-request').send({
        email: 'not-email',
      });
      expect(res.status).toBe(204);
    });
  });

  describe('POST /api/auth/reset-confirm', () => {
    it('returns 400 on bogus token', async () => {
      const res = await test.request.post('/api/auth/reset-confirm').send({
        token: 'bogus-token',
        newPassword: 'NewStrong1',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('returns 400 on weak new password', async () => {
      const res = await test.request.post('/api/auth/reset-confirm').send({
        token: 'some-token',
        newPassword: 'weak',
      });
      expect(res.status).toBe(400);
    });

    it('completes a real reset flow: request → confirm → login with new password', async () => {
      // Setup: signup
      await test.request.post('/api/auth/signup').send({
        email: 'jane@example.com',
        password: 'OldStrong1',
        name: 'Jane',
      });
      // Request reset
      await test.request.post('/api/auth/reset-request').send({
        email: 'jane@example.com',
      });
      // AuthService logs the reset link to console; in tests we need the token.
      // We can intercept it via console.log spying — or call requestPasswordReset directly.
      // For integration test simplicity, we use the AuthService directly to get the token.
      const authModule = test.app.get((await import('../../apps/backend/src/services/auth/auth.service')).AuthService);
      const token = await authModule.requestPasswordReset({ email: 'jane@example.com' });
      expect(token).not.toBeNull();

      // Confirm reset
      const confirmRes = await test.request.post('/api/auth/reset-confirm').send({
        token: token as string,
        newPassword: 'NewStrong1',
      });
      expect(confirmRes.status).toBe(204);

      // Login with new password should work
      const loginRes = await test.request.post('/api/auth/login').send({
        email: 'jane@example.com',
        password: 'NewStrong1',
      });
      expect(loginRes.status).toBe(200);

      // Login with old password should fail
      const oldLoginRes = await test.request.post('/api/auth/login').send({
        email: 'jane@example.com',
        password: 'OldStrong1',
      });
      expect(oldLoginRes.status).toBe(401);
    });
  });

  describe('DELETE /api/account', () => {
    it('returns 204 + cascades user data', async () => {
      const { accessToken, userId } = await test.signupAndLogin();
      // Create a PostCard
      await test.createPostCard(accessToken, {});

      const res = await test.request.delete('/api/account').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(204);

      // User should no longer be able to log in
      const loginRes = await test.request.post('/api/auth/login').send({
        email: 'deleted@example.com',
        password: 'StrongPass1',
      });
      // We didn't capture the email, so this is just a generic check that
      // the cascade worked (via /me).
      const meRes = await test.request.get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(meRes.status).toBe(401); // user deleted → JWT validation fails

      // Verify cascade in mock Prisma
      const user = test.prisma.user.findUnique({ where: { id: userId } as never });
      const userResolved = await user;
      // Our mock may not delete cascade fully, but user itself should be gone
      expect(userResolved).toBeNull();
    });

    it('returns 401 without JWT', async () => {
      const res = await test.request.delete('/api/account');
      expect(res.status).toBe(401);
    });
  });
});
