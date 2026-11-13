import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// /home/z/my-project/netamplify-app/apps/frontend/vite.config.ts
// NetAmplify — Vite config for the React frontend.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4200,
    proxy: {
      // xfwd: true makes Vite's http-proxy add x-forwarded-proto / x-forwarded-host /
      // x-forwarded-for headers so the backend can reconstruct the origin the
      // user's browser is actually on (localhost:4200 in dev, or the ngrok URL
      // when tunneled). Without this, changeOrigin rewrites Host to localhost:3000
      // and the backend cannot build correct OAuth redirect / frontend URLs.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        xfwd: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
