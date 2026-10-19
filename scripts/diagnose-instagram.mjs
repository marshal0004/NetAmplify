#!/usr/bin/env node
// /home/z/my-project/netamplify-app/scripts/diagnose-instagram.mjs
// NetAmplify — Instagram Standalone OAuth diagnostic.
//
// Verifies that your .env has all the required env vars for Instagram
// Standalone OAuth. Run with: `node scripts/diagnose-instagram.mjs`
//
// Exit codes:
//   0 — all checks pass
//   1 — one or more checks failed

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';

const ENV_PATH = resolve(process.cwd(), '.env');

console.log('═'.repeat(72));
console.log('  NetAmplify — Instagram Standalone OAuth Diagnostic');
console.log('═'.repeat(72));

// ─── Load .env ────────────────────────────────────────────────────────────
if (!existsSync(ENV_PATH)) {
  console.log(`\n❌ No .env file found at: ${ENV_PATH}`);
  console.log('   Create one by copying .env.example → .env, then fill in the values.');
  process.exit(1);
}

const envRaw = readFileSync(ENV_PATH, 'utf-8');
const env = parse(envRaw);

console.log(`\n✓ .env file found: ${ENV_PATH}`);

// ─── Check INSTAGRAM_APP_ID ──────────────────────────────────────────────
console.log('\n─── INSTAGRAM_APP_ID ────────────────────────────────────────');
const igAppId = env.INSTAGRAM_APP_ID || process.env.INSTAGRAM_APP_ID;
if (!igAppId) {
  console.log('❌ INSTAGRAM_APP_ID is NOT SET in .env');
  console.log('   → Get this from your Meta dashboard:');
  console.log('     https://developers.facebook.com/apps/<your-app-id>');
  console.log('     → Instagram API → "Instagram app ID" (15-16 digit number)');
  console.log('   → Add this line to your .env:');
  console.log('     INSTAGRAM_APP_ID=<your-ig-app-id>');
} else if (igAppId.length < 10) {
  console.log(`⚠️  INSTAGRAM_APP_ID looks too short: "${igAppId}"`);
  console.log('   Instagram App IDs are typically 15-16 digits.');
} else {
  console.log(`✓ INSTAGRAM_APP_ID = ${igAppId}`);
}

// ─── Check INSTAGRAM_APP_SECRET ──────────────────────────────────────────
console.log('\n─── INSTAGRAM_APP_SECRET ────────────────────────────────────');
const igAppSecret = env.INSTAGRAM_APP_SECRET || process.env.INSTAGRAM_APP_SECRET;
if (!igAppSecret) {
  console.log('❌ INSTAGRAM_APP_SECRET is NOT SET in .env');
  console.log('   → Get this from your Meta dashboard:');
  console.log('     https://developers.facebook.com/apps/<your-app-id>');
  console.log('     → Instagram API → "Instagram app secret" → click "Show"');
  console.log('   → Add this line to your .env:');
  console.log('     INSTAGRAM_APP_SECRET=<your-ig-app-secret>');
} else if (igAppSecret.length < 20) {
  console.log(`⚠️  INSTAGRAM_APP_SECRET looks too short (${igAppSecret.length} chars).`);
  console.log('   App secrets are typically 32 chars.');
} else {
  console.log(`✓ INSTAGRAM_APP_SECRET = ${'*'.repeat(igAppSecret.length - 4)}${igAppSecret.slice(-4)} (length: ${igAppSecret.length})`);
}

// ─── Check PUBLIC_APP_URL ────────────────────────────────────────────────
console.log('\n─── PUBLIC_APP_URL ─────────────────────────────────────────');
const publicAppUrl = env.PUBLIC_APP_URL || process.env.PUBLIC_APP_URL;
if (!publicAppUrl) {
  console.log('❌ PUBLIC_APP_URL is NOT SET in .env');
  console.log('   → Instagram rejects http://localhost redirect URIs.');
  console.log('   → For local dev, run `ngrok http 4200` and copy the HTTPS URL.');
  console.log('   → Add this line to your .env (replace with YOUR ngrok URL):');
  console.log('     PUBLIC_APP_URL=https://abc-xyz.ngrok-free.app');
} else {
  try {
    const url = new URL(publicAppUrl);
    if (url.protocol !== 'https:') {
      console.log(`❌ PUBLIC_APP_URL is not HTTPS: "${publicAppUrl}"`);
      console.log('   Instagram REQUIRES HTTPS redirect URIs.');
    } else if (publicAppUrl.endsWith('/')) {
      console.log(`⚠️  PUBLIC_APP_URL should not end with /: "${publicAppUrl}"`);
    } else {
      console.log(`✓ PUBLIC_APP_URL = ${publicAppUrl}`);
    }
  } catch {
    console.log(`❌ PUBLIC_APP_URL is not a valid URL: "${publicAppUrl}"`);
  }
}

// ─── Check Meta dashboard redirect URI (informational) ───────────────────
console.log('\n─── Meta Dashboard Redirect URI ────────────────────────────');
if (publicAppUrl && publicAppUrl.startsWith('https://')) {
  const expectedRedirectUri = `${publicAppUrl}/api/oauth/instagram/callback`;
  console.log(`✓ Expected redirect URI (add this to Meta dashboard):`);
  console.log(`  ${expectedRedirectUri}`);
  console.log('\n  Add it in TWO places in your Meta dashboard:');
  console.log('  1. Instagram API → "Set up Instagram business login" → Redirect URI');
  console.log('  2. Facebook Login → Settings → Valid OAuth Redirect URIs');
} else {
  console.log('⚠️  Cannot compute expected redirect URI (PUBLIC_APP_URL not set or not HTTPS).');
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
const allGood = igAppId && igAppSecret && publicAppUrl && publicAppUrl.startsWith('https://');
if (allGood) {
  console.log('  ✅ All checks passed! Instagram Standalone OAuth is configured.');
  console.log('\n  Next steps:');
  console.log('  1. Restart the backend: pnpm dev:backend');
  console.log('  2. Refresh the Connections page in your browser');
  console.log('  3. The Instagram card should now show "Connect via OAuth" button');
  console.log('  4. Click Connect → Instagram login page appears (not Facebook\'s)');
  process.exit(0);
} else {
  console.log('  ❌ Some checks failed. Fix the issues above, then re-run this script.');
  console.log('\n  After fixing the .env:');
  console.log('  1. Restart the backend: pnpm dev:backend');
  console.log('  2. Re-run this diagnostic: node scripts/diagnose-instagram.mjs');
  console.log('  3. When all checks pass, refresh the Connections page');
  process.exit(1);
}
console.log('═'.repeat(72));
