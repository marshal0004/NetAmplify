// /home/z/my-project/netamplify-app/tests/integration/non-functional.integration.test.ts
// NetAmplify — Non-functional tests:
//   - Error envelope shape (every error response matches the spec)
//   - Security headers (CORS, no token in response body)
//   - Idempotency (same requestId returns same Post)
//   - Ownership enforcement (403/404 for cross-user access)
//   - JWT validation (invalid/expired tokens)
//   - Rate limiting (disabled in tests — ThrottlerModule is mocked)
//   - Audit log entries on every action

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app';

describe('Non-functional: error envelope shape', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await createTestApp();
  });
  afterEach(async () => test.close());

  it('every error response has { error: { code, message } } shape', async () => {
    const res = await test.request.get('/api/auth/me'); // no JWT
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
    expect(typeof res.body.error.code).toBe('string');
    expect(typeof res.body.error.message).toBe('string');
  });

  it('400 VALIDATION_ERROR includes fieldErrors', async () => {
    const res = await test.request.post('/api/auth/signup').send({ email: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fieldErrors).toBeDefined();
  });

  it('404 NOT_FOUND responses have code NOT_FOUND', async () => {
    const auth = await test.signupAndLogin();
    const res = await test.request.get('/api/postcards/nonexistent')
      .set('Authorization', `Bearer ${auth.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('409 CONFLICT for duplicate signup has code EMAIL_TAKEN', async () => {
    await test.request.post('/api/auth/signup').send({
      email: 'dupe@example.com', password: 'StrongPass1', name: 'X',
    });
    const res = await test.request.post('/api/auth/signup').send({
      email: 'dupe@example.com', password: 'StrongPass1', name: 'Y',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('401 INVALID_CREDENTIALS does NOT leak whether email exists', async () => {
    // Signup one user
    await test.request.post('/api/auth/signup').send({
      email: 'exists@example.com', password: 'StrongPass1', name: 'X',
    });
    // Login with wrong password — should be 401 INVALID_CREDENTIALS
    const wrongPw = await test.request.post('/api/auth/login').send({
      email: 'exists@example.com', password: 'WrongPass1',
    });
    expect(wrongPw.status).toBe(401);
    expect(wrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPw.body.error.message).toBe('Invalid email or password');

    // Login with non-existent email — should be SAME error
    const unknownEmail = await test.request.post('/api/auth/login').send({
      email: 'nonexistent@example.com', password: 'StrongPass1',
    });
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.message).toBe('Invalid email or password');

    // Error responses are byte-for-byte identical
    expect(JSON.stringify(wrongPw.body)).toBe(JSON.stringify(unknownEmail.body));
  });
});

describe('Non-functional: ownership enforcement', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await createTestApp();
  });
  afterEach(async () => test.close());

  it('user A cannot read user B\'s PostCard (returns 404, not 403, to prevent enumeration)', async () => {
    const userA = await test.signupAndLogin();
    const userB = await test.signupAndLogin();

    // User A creates a PostCard
    const cardRes = await test.request.post('/api/postcards')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ title: 'T', summary: 'S', description: 'D', techStack: ['a'] });
    expect(cardRes.status).toBe(201);
    const cardId = cardRes.body.id;

    // User B tries to access user A's PostCard → 404
    const res = await test.request.get(`/api/postcards/${cardId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(res.status).toBe(404);
  });

  it('user A cannot delete user B\'s PostCard', async () => {
    const userA = await test.signupAndLogin();
    const userB = await test.signupAndLogin();

    const cardRes = await test.request.post('/api/postcards')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ title: 'T', summary: 'S', description: 'D', techStack: ['a'] });
    const cardId = cardRes.body.id;

    const res = await test.request.delete(`/api/postcards/${cardId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(res.status).toBe(404);

    // Verify it still exists for user A
    const stillThere = await test.request.get(`/api/postcards/${cardId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);
    expect(stillThere.status).toBe(200);
  });

  it('user A\'s connections list does NOT include user B\'s connections', async () => {
    // Setup mock adapter for Discord
    test = await createTestApp({
      mockAdapters: [
        { platform: 'DISCORD', validateResult: { identity: { id: 'chan-A', username: '#userA-channel' }, credentials: { webhookUrl: 'https://discord.com/api/webhooks/1/a' } } },
      ],
    });
    const userA = await test.signupAndLogin('usera@example.com');
    const userB = await test.signupAndLogin('userb@example.com');

    // User A connects Discord
    await test.request.post('/api/connections/discord')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ webhookUrl: 'https://discord.com/api/webhooks/1/a' });

    // User B's list — should NOT show user A's Discord connection
    const listB = await test.request.get('/api/connections')
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(listB.status).toBe(200);
    const discordB = listB.body.find((c: { platform: string }) => c.platform === 'DISCORD');
    expect(discordB.platformUsername).toBeNull();

    // User A's list — should show their Discord connection
    const listA = await test.request.get('/api/connections')
      .set('Authorization', `Bearer ${userA.accessToken}`);
    const discordA = listA.body.find((c: { platform: string }) => c.platform === 'DISCORD');
    expect(discordA.platformUsername).toBe('#userA-channel');
  });
});

describe('Non-functional: idempotency', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await createTestApp({
      mockAdapters: [
        { platform: 'DISCORD', validateResult: { identity: { id: 'c', username: '#c' }, credentials: { webhookUrl: 'https://discord.com/api/webhooks/1/a' } },
          publishResult: { id: 'm', url: 'https://discord.com/channels/c/m' } },
      ],
    });
  });
  afterEach(async () => test.close());

  it('publishing with same requestId twice returns the same Post (no re-publish)', async () => {
    const auth = await test.signupAndLogin();
    const card = await test.createPostCard(auth.accessToken, {});
    await test.request.post('/api/connections/discord')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ webhookUrl: 'https://discord.com/api/webhooks/1/a' });

    const requestId = `idempotency-${Date.now()}`;
    const r1 = await test.request.post(`/api/postcards/${card.id}/publish`)
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ platforms: [{ platform: 'DISCORD' }], requestId });
    expect(r1.status).toBe(201);

    const r2 = await test.request.post(`/api/postcards/${card.id}/publish`)
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ platforms: [{ platform: 'DISCORD' }], requestId });
    expect(r2.status).toBe(201);
    expect(r2.body.post.id).toBe(r1.body.post.id);

    // Only 1 job enqueued (idempotent)
    expect(test.queue._jobs.length).toBe(1);
  });
});

describe('Non-functional: JWT validation', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await createTestApp();
  });
  afterEach(async () => test.close());

  it('rejects malformed JWT', async () => {
    const res = await test.request.get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('rejects JWT signed with a different secret', async () => {
    // Create a JWT with a fake secret
    const { JwtService } = await import('@nestjs/jwt');
    const fakeJwt = new JwtService({ secret: 'wrong-secret', signOptions: { expiresIn: 60 * 60 } });
    const token = fakeJwt.sign({ sub: 'fake-user', email: 'fake@example.com' });

    const res = await test.request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects JWT without Bearer prefix', async () => {
    const auth = await test.signupAndLogin();
    const res = await test.request.get('/api/auth/me').set('Authorization', auth.accessToken);
    expect(res.status).toBe(401);
  });
});

describe('Non-functional: audit log entries', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await createTestApp();
  });
  afterEach(async () => test.close());

  it('records an audit log on signup', async () => {
    await test.request.post('/api/auth/signup').send({
      email: 'audit@example.com', password: 'StrongPass1', name: 'Test',
    });
    // Find the audit logs for this user
    const logs = (test.prisma as unknown as { _auditLogs: Array<{ userId: string; action: string }> })._auditLogs;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.action === 'LOGIN')).toBe(true);
  });

  it('records an audit log on login fail', async () => {
    // Signup
    await test.request.post('/api/auth/signup').send({
      email: 'audit@example.com', password: 'StrongPass1', name: 'Test',
    });
    // Failed login
    await test.request.post('/api/auth/login').send({
      email: 'audit@example.com', password: 'WrongPass1',
    });
    const logs = (test.prisma as unknown as { _auditLogs: Array<{ action: string }> })._auditLogs;
    expect(logs.some((l) => l.action === 'LOGIN_FAIL')).toBe(true);
  });
});

describe('Non-functional: no plaintext credentials in responses', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await createTestApp({
      mockAdapters: [
        { platform: 'DISCORD', validateResult: { identity: { id: 'c', username: '#showcase' }, credentials: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' } } },
      ],
    });
  });
  afterEach(async () => test.close());

  it('GET /api/connections never returns credentialsCipher', async () => {
    const auth = await test.signupAndLogin();
    await test.request.post('/api/connections/discord')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' });

    const listRes = await test.request.get('/api/connections')
      .set('Authorization', `Bearer ${auth.accessToken}`);
    expect(listRes.status).toBe(200);
    for (const c of listRes.body) {
      expect(c).not.toHaveProperty('credentialsCipher');
      // The original webhookUrl is not echoed back either
      expect(c).not.toHaveProperty('webhookUrl');
    }
  });

  it('GET /api/auth/me does not return passwordHash', async () => {
    const auth = await test.signupAndLogin();
    const res = await test.request.get('/api/auth/me').set('Authorization', `Bearer ${auth.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('passwordHash');
  });
});
