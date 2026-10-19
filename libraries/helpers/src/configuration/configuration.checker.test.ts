// /home/z/my-project/netamplify-app/libraries/helpers/src/configuration/configuration.checker.test.ts
// Vitest unit tests for ConfigurationChecker — Instagram-specific checks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigurationChecker } from './configuration.checker';

describe('ConfigurationChecker — Instagram checks', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to a clean baseline: required vars set so non-Instagram checks pass
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-jwt-secret',
      FRONTEND_URL: 'http://localhost:4200',
      STORAGE_PROVIDER: 'local',
      // Instagram vars intentionally NOT set by default
    };
    delete process.env.INSTAGRAM_APP_ID;
    delete process.env.INSTAGRAM_APP_SECRET;
    delete process.env.PUBLIC_APP_URL;
    delete process.env.MAIN_URL;
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    delete process.env.BACKEND_INTERNAL_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does NOT warn when all Instagram env vars are unset (silence for non-IG users)', () => {
    const checker = new ConfigurationChecker();
    checker.readEnvFromProcess();
    checker.check();
    const igIssues = checker.getIssues().filter((i) =>
      i.includes('INSTAGRAM') || i.includes('PUBLIC_APP_URL'),
    );
    expect(igIssues).toEqual([]);
  });

  it('does NOT warn when all Instagram env vars are correctly set', () => {
    process.env.INSTAGRAM_APP_ID = '1782847289700445';
    process.env.INSTAGRAM_APP_SECRET = 'a'.repeat(32);
    process.env.PUBLIC_APP_URL = 'https://abc.ngrok-free.app';

    const checker = new ConfigurationChecker();
    checker.readEnvFromProcess();
    checker.check();
    const igIssues = checker.getIssues().filter((i) =>
      i.includes('INSTAGRAM') || i.includes('PUBLIC_APP_URL'),
    );
    expect(igIssues).toEqual([]);
  });

  it('warns when INSTAGRAM_APP_ID is set but INSTAGRAM_APP_SECRET is missing', () => {
    process.env.INSTAGRAM_APP_ID = '1782847289700445';
    // INSTAGRAM_APP_SECRET intentionally unset

    const checker = new ConfigurationChecker();
    checker.readEnvFromProcess();
    checker.check();
    const igIssues = checker.getIssues().filter((i) =>
      i.includes('INSTAGRAM_APP_SECRET is set but INSTAGRAM_APP_ID') ||
      i.includes('INSTAGRAM_APP_ID is set but INSTAGRAM_APP_SECRET'),
    );
    expect(igIssues.length).toBe(1);
    expect(igIssues[0]).toContain('INSTAGRAM_APP_SECRET is missing');
  });

  it('warns when INSTAGRAM_APP_SECRET is set but INSTAGRAM_APP_ID is missing', () => {
    // INSTAGRAM_APP_ID intentionally unset
    process.env.INSTAGRAM_APP_SECRET = 'a'.repeat(32);

    const checker = new ConfigurationChecker();
    checker.readEnvFromProcess();
    checker.check();
    const igIssues = checker.getIssues().filter((i) =>
      i.includes('INSTAGRAM_APP_ID is missing'),
    );
    expect(igIssues.length).toBe(1);
  });

  it('warns when INSTAGRAM_APP_ID/SECRET are set but PUBLIC_APP_URL is missing', () => {
    process.env.INSTAGRAM_APP_ID = '1782847289700445';
    process.env.INSTAGRAM_APP_SECRET = 'a'.repeat(32);
    // PUBLIC_APP_URL intentionally unset

    const checker = new ConfigurationChecker();
    checker.readEnvFromProcess();
    checker.check();
    const igIssues = checker.getIssues().filter((i) =>
      i.includes('PUBLIC_APP_URL not set'),
    );
    expect(igIssues.length).toBe(1);
    expect(igIssues[0]).toContain('Instagram rejects http://localhost');
  });

  it('warns when PUBLIC_APP_URL is http:// (not HTTPS)', () => {
    process.env.INSTAGRAM_APP_ID = '1782847289700445';
    process.env.INSTAGRAM_APP_SECRET = 'a'.repeat(32);
    process.env.PUBLIC_APP_URL = 'http://localhost:4200';

    const checker = new ConfigurationChecker();
    checker.readEnvFromProcess();
    checker.check();
    const igIssues = checker.getIssues().filter((i) =>
      i.includes('PUBLIC_APP_URL must be HTTPS'),
    );
    expect(igIssues.length).toBe(1);
  });

  it('warns when PUBLIC_APP_URL ends with /', () => {
    process.env.INSTAGRAM_APP_ID = '1782847289700445';
    process.env.INSTAGRAM_APP_SECRET = 'a'.repeat(32);
    process.env.PUBLIC_APP_URL = 'https://abc.ngrok-free.app/';

    const checker = new ConfigurationChecker();
    checker.readEnvFromProcess();
    checker.check();
    const igIssues = checker.getIssues().filter((i) =>
      i.includes('PUBLIC_APP_URL should not end with /'),
    );
    expect(igIssues.length).toBe(1);
  });

  it('warns when PUBLIC_APP_URL is not a valid URL', () => {
    process.env.INSTAGRAM_APP_ID = '1782847289700445';
    process.env.INSTAGRAM_APP_SECRET = 'a'.repeat(32);
    process.env.PUBLIC_APP_URL = 'not-a-url';

    const checker = new ConfigurationChecker();
    checker.readEnvFromProcess();
    checker.check();
    const igIssues = checker.getIssues().filter((i) =>
      i.includes('PUBLIC_APP_URL is not a valid URL'),
    );
    expect(igIssues.length).toBe(1);
  });
});
