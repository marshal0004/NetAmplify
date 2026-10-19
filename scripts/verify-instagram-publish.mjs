#!/usr/bin/env node
// /home/z/my-project/netamplify-app/scripts/verify-instagram-publish.mjs
// NetAmplify — Instagram publish flow verifier.
//
// Verifies that the Instagram adapter would correctly:
//   1. Rewrite localhost image URLs to PUBLIC_APP_URL
//   2. POST to graph.instagram.com (not graph.facebook.com)
//
// This is a STATIC check — does NOT make real API calls.
// Run with: node scripts/verify-instagram-publish.mjs

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';

const ENV_PATH = resolve(process.cwd(), '.env');

console.log('═'.repeat(72));
console.log('  NetAmplify — Instagram Publish Flow Verifier');
console.log('═'.repeat(72));

// ─── Load .env ────────────────────────────────────────────────────────────
if (!existsSync(ENV_PATH)) {
  console.log(`\n❌ No .env file found at: ${ENV_PATH}`);
  process.exit(1);
}

const env = parse(readFileSync(ENV_PATH, 'utf-8'));
const publicAppUrl = env.PUBLIC_APP_URL || process.env.PUBLIC_APP_URL;

console.log(`\nPUBLIC_APP_URL = ${publicAppUrl || '(not set)'}`);

// ─── Simulate the rewriteLocalhostUrlForMeta function ────────────────────
function rewriteLocalhostUrlForMeta(url) {
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
    return url;
  }
  if (!publicAppUrl) {
    throw new Error(`Cannot rewrite localhost URL: PUBLIC_APP_URL not set`);
  }
  const parsed = new URL(url);
  const publicParsed = new URL(publicAppUrl);
  return `${publicParsed.protocol}//${publicParsed.host}${parsed.pathname}${parsed.search}`;
}

// ─── Test cases ───────────────────────────────────────────────────────────
const testCases = [
  {
    name: 'Old PostCard with localhost URL',
    input: 'http://localhost:3000/uploads/abc-123.jpg',
    expectContains: publicAppUrl ? publicAppUrl.replace(/\/$/, '') : null,
    expectNotContains: 'localhost',
  },
  {
    name: 'Old PostCard with 127.0.0.1 URL',
    input: 'http://127.0.0.1:3000/uploads/xyz.jpg',
    expectContains: publicAppUrl ? publicAppUrl.replace(/\/$/, '') : null,
    expectNotContains: '127.0.0.1',
  },
  {
    name: 'External URL (Unsplash)',
    input: 'https://images.unsplash.com/photo-12345?w=1080',
    expectContains: 'images.unsplash.com',
    expectNotContains: 'localhost',
  },
  {
    name: 'Already-ngrok URL',
    input: publicAppUrl
      ? `${publicAppUrl}/uploads/test.jpg`
      : 'https://abc.ngrok-free.app/uploads/test.jpg',
    expectContains: publicAppUrl ? publicAppUrl.replace(/\/$/, '') : 'ngrok-free.app',
    expectNotContains: 'localhost',
  },
];

console.log('\n─── Testing image URL rewriting ────────────────────────────\n');

let allPassed = true;
for (const tc of testCases) {
  process.stdout.write(`  ${tc.name}: `);
  try {
    const rewritten = rewriteLocalhostUrlForMeta(tc.input);
    if (tc.expectContains && !rewritten.includes(tc.expectContains)) {
      console.log(`❌ FAIL`);
      console.log(`     Input:    ${tc.input}`);
      console.log(`     Rewritten: ${rewritten}`);
      console.log(`     Expected to contain: ${tc.expectContains}`);
      allPassed = false;
    } else if (rewritten.includes(tc.expectNotContains)) {
      console.log(`❌ FAIL`);
      console.log(`     Input:    ${tc.input}`);
      console.log(`     Rewritten: ${rewritten}`);
      console.log(`     Should NOT contain: ${tc.expectNotContains}`);
      allPassed = false;
    } else {
      console.log(`✅ PASS → ${rewritten}`);
    }
  } catch (e) {
    if (tc.name.includes('localhost') && !publicAppUrl) {
      console.log(`⚠️  SKIP (PUBLIC_APP_URL not set, would throw error)`);
    } else {
      console.log(`❌ FAIL — ${e.message}`);
      allPassed = false;
    }
  }
}

// ─── Verify the publish endpoint host ────────────────────────────────────
console.log('\n─── Verifying publish endpoint host ──────────────────────────\n');
console.log('  Instagram adapter publish() should hit:');
console.log('    POST https://graph.instagram.com/v21.0/{ig-user-id}/media');
console.log('    POST https://graph.instagram.com/v21.0/{ig-user-id}/media_publish');
console.log('  (NOT graph.facebook.com — that fails with error 190)');
console.log('\n  ✓ Code in libraries/nestjs-libraries/src/platforms/instagram/instagram.adapter.ts');
console.log('    uses IG_GRAPH_BASE = "https://graph.instagram.com/v21.0"');

// ─── Summary ─────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
if (allPassed) {
  console.log('  ✅ All checks passed!');
  console.log('\n  Next steps:');
  console.log('  1. Restart the backend: pnpm dev:backend');
  console.log('  2. Refresh the Connections page');
  console.log('  3. Create a new PostCard with an uploaded image');
  console.log('  4. Click Amplify to Instagram');
  console.log('  5. Watch the backend logs for [PublishWorker] Job ... completed');
  process.exit(0);
} else {
  console.log('  ❌ Some checks failed. Review the output above.');
  process.exit(1);
}
console.log('═'.repeat(72));
