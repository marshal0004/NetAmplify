// /home/z/my-project/netamplify-app/vitest.config.ts
// NetAmplify — Vitest configuration (replaces Jest).
//
// Test tiers:
//   - Unit: pure functions (vault, formatters, validators, error mapper) — no DB
//   - Integration: API routes with testcontainers Postgres + Redis
//     (run via `pnpm test:integration` on Arch; sandbox has no Docker)
//   - E2E: Playwright browser flows (separate playwright.config.ts in Phase 6)
//
// Unit tests run by default; integration tests are filtered out unless
// `--include integration` is passed.

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] })],
  test: {
    environment: 'node',
    include: [
      'libraries/**/*.test.ts',
      'apps/backend/**/*.test.ts',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'apps/frontend/**',
      '**/*.integration.test.ts',
      '**/*.e2e.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'libraries/nestjs-libraries/src/services/vault/**',
        'libraries/nestjs-libraries/src/validation/**',
        'libraries/nestjs-libraries/src/services/error.mapper.ts',
        'libraries/nestjs-libraries/src/config/env.ts',
        'apps/backend/src/services/auth/**/*.ts',
        'apps/backend/src/api/routes/auth.controller.ts',
        'apps/backend/src/api/routes/health.controller.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.spec.ts', 'dist/**', 'node_modules/**'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    globals: true,
    testTimeout: 10000,
    hookTimeout: 15000,
    restoreMocks: true,
  },
});
