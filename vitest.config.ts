// /home/z/my-project/netamplify-app/vitest.config.ts
// NetAmplify — Vitest configuration.
//
// Uses explicit path aliases instead of vite-tsconfig-paths (which is
// ESM-only and incompatible with vitest's config loader in the monorepo).

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@netamplify/backend': path.resolve(__dirname, 'apps/backend/src'),
      '@netamplify/frontend': path.resolve(__dirname, 'apps/frontend/src'),
      '@netamplify/helpers': path.resolve(__dirname, 'libraries/helpers/src'),
      '@netamplify/nestjs-libraries': path.resolve(__dirname, 'libraries/nestjs-libraries/src'),
      '@netamplify/react': path.resolve(__dirname, 'libraries/react-shared-libraries/src'),
      '@netamplify/plugins': path.resolve(__dirname, 'libraries/plugins/src'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'libraries/**/*.test.ts',
      'apps/backend/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'apps/frontend/**',
    ],
    globals: true,
    testTimeout: 10000,
    hookTimeout: 15000,
    restoreMocks: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
