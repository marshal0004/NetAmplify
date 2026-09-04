// /home/z/my-project/netamplify-app/vitest.setup.ts
// Runs BEFORE any test files import their dependencies. Sets env vars
// so the redis.service.ts picks the MockRedis, the worker doesn't start,
// and the TokenVault / AuthService get test secrets.

process.env.NODE_ENV = 'test';
process.env.VITEST = 'true';
process.env.DISABLE_WORKERS = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-not-for-prod';
process.env.TOKEN_ENCRYPTION_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
process.env.EMAIL_PROVIDER = '';
process.env.NOT_SECURED = 'true';
process.env.X_MONTHLY_POST_BUDGET = '450';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.PUBLIC_APP_URL = 'http://localhost:3000';
// IMPORTANT: do NOT set REDIS_URL — that triggers real ioredis connect attempts.
// The MockRedis is used when REDIS_URL is undefined OR when NODE_ENV === 'test'.
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
