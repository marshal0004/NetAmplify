// /home/z/my-project/netamplify-app/tests/integration/auto-capture.integration.test.ts
// NetAmplify — Integration tests for the POST /api/connections/:platform/auto-capture endpoint.
//
// This endpoint is called by the Tauri desktop app after it captures
// cookies from the native WebView login window. It maps cookie names
// (token_v2, csrf_token, auth_token, ct0) to the adapter's input fields
// (tokenV2, csrfToken, authToken, ct0) and then calls the existing
// saveSimpleConnection flow.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestApp, type MockAdapterConfig } from '../helpers/test-app';

// Valid-looking JWT shapes for testing (header.payload.signature).
// Each part is base64url (A-Za-z0-9_-) and total length ≥100 chars.
// These pass the Zod schema validation without needing to be real JWTs.
const MOCK_REDDIT_JWT_HEADER = 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LWZvci10ZXN0aW5nLXB1cnBvc2VzLW9ubHktbm90LWEtcmVhbC1rZXkifQ';
const MOCK_REDDIT_JWT_PAYLOAD = 'eyJzdWIiOiJ1c2VyIiwiZXhwIjoxODA1MjA4MjUxLCJsaWQiOiJ0Ml90ZXN0MTIzIiwiY2lkIjoiMFItV0FNaHVvby1NeVEiLCJzY3AiOiJzdWJtaXQifQ';
const MOCK_REDDIT_JWT_SIG = 'dGhpcy1pcy1hLWZha2Utc2lnbmF0dXJlLWZvci10ZXN0aW5nLXB1cnBvc2VzLW9ubHktbm90LWEtcmVhbC1zaWduYXR1cmUtdGhpcy1pcy1sb25nLWVub3VnaC10by1wYXNzLXRoZS0xMDAtY2hhci1taW5pbXVtLXZhbGlkYXRpb24';
const MOCK_REDDIT_JWT = `${MOCK_REDDIT_JWT_HEADER}.${MOCK_REDDIT_JWT_PAYLOAD}.${MOCK_REDDIT_JWT_SIG}`;
const MOCK_REDDIT_CSRF = 'abcdef0123456789abcdef0123456789';
const MOCK_X_AUTH_TOKEN = 'a'.repeat(40);
const MOCK_X_CT0 = 'b'.repeat(32);

describe('Integration: Auto-Capture endpoint', () => {
  let test: TestApp;
  let token: string;

  beforeEach(async () => {
    test = await createTestApp({
      mockAdapters: [
        {
          platform: 'REDDIT_COOKIE',
          validateResult: {
            identity: { id: 't2_test123', username: 'u/testuser' },
            credentials: {
              tokenV2: MOCK_REDDIT_JWT,
              csrfToken: MOCK_REDDIT_CSRF,
            },
          },
        },
        {
          platform: 'TWITTER_COOKIE',
          validateResult: {
            identity: { id: '1234567890', username: '@testuser' },
            credentials: {
              authToken: MOCK_X_AUTH_TOKEN,
              ct0: MOCK_X_CT0,
            },
          },
        },
      ] as MockAdapterConfig[],
    });

    // Signup to get a JWT
    const signupResp = await test.request
      .post('/api/auth/signup')
      .send({ email: `autocap_${Date.now()}@test.com`, password: 'StrongPass1', name: 'Test User' });
    const body = JSON.parse(signupResp.text);
    token = body.accessToken;
  });

  afterEach(async () => {
    await test.close();
  });

  describe('POST /api/connections/reddit-cookie/auto-capture', () => {
    it('returns 201 + username on valid Reddit cookies', async () => {
      const resp = await test.request
        .post('/api/connections/reddit-cookie/auto-capture')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cookies: {
            token_v2: MOCK_REDDIT_JWT,
            csrf_token: MOCK_REDDIT_CSRF,
            token: MOCK_REDDIT_JWT,
          },
        });

      expect(resp.status).toBe(201);
      const body = JSON.parse(resp.text);
      expect(body.id).toBeDefined();
      expect(body.username).toBe('u/testuser');
    });

    it('returns 201 without optional legacy `token` cookie', async () => {
      const resp = await test.request
        .post('/api/connections/reddit-cookie/auto-capture')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cookies: {
            token_v2: MOCK_REDDIT_JWT,
            csrf_token: MOCK_REDDIT_CSRF,
          },
        });

      expect(resp.status).toBe(201);
      const body = JSON.parse(resp.text);
      expect(body.username).toBe('u/testuser');
    });

    it('returns 400 when required token_v2 cookie is missing', async () => {
      const resp = await test.request
        .post('/api/connections/reddit-cookie/auto-capture')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cookies: {
            csrf_token: MOCK_REDDIT_CSRF,
          },
        });

      expect(resp.status).toBe(400);
    });

    it('returns 400 when cookies object is missing entirely', async () => {
      const resp = await test.request
        .post('/api/connections/reddit-cookie/auto-capture')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(resp.status).toBe(400);
    });

    it('returns 401 without JWT authentication', async () => {
      const resp = await test.request
        .post('/api/connections/reddit-cookie/auto-capture')
        .send({
          cookies: { token_v2: MOCK_REDDIT_JWT, csrf_token: MOCK_REDDIT_CSRF },
        });

      expect(resp.status).toBe(401);
    });
  });

  describe('POST /api/connections/twitter-cookie/auto-capture', () => {
    it('returns 201 + username on valid X cookies', async () => {
      const resp = await test.request
        .post('/api/connections/twitter-cookie/auto-capture')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cookies: {
            auth_token: MOCK_X_AUTH_TOKEN,
            ct0: MOCK_X_CT0,
          },
        });

      expect(resp.status).toBe(201);
      const body = JSON.parse(resp.text);
      expect(body.id).toBeDefined();
      expect(body.username).toBe('@testuser');
    });

    it('returns 400 when required auth_token cookie is missing', async () => {
      const resp = await test.request
        .post('/api/connections/twitter-cookie/auto-capture')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cookies: {
            ct0: MOCK_X_CT0,
          },
        });

      expect(resp.status).toBe(400);
    });
  });

  describe('POST /api/connections/:platform/auto-capture (validation)', () => {
    it('returns 400 for non-cookie platforms (e.g., DEVTO)', async () => {
      const resp = await test.request
        .post('/api/connections/devto/auto-capture')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cookies: { apiKey: 'devto-key' },
        });

      expect(resp.status).toBe(400);
      const body = JSON.parse(resp.text);
      expect(body.error.message).toMatch(/auto-capture is only supported for TWITTER_COOKIE and REDDIT_COOKIE/i);
    });

    it('returns 400 for unknown platform', async () => {
      const resp = await test.request
        .post('/api/connections/unknown-platform/auto-capture')
        .set('Authorization', `Bearer ${token}`)
        .send({ cookies: {} });

      expect(resp.status).toBe(400);
    });
  });
});
