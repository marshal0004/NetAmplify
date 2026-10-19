#!/usr/bin/env node
// /home/z/my-project/netamplify-app/scripts/verify-instagram-oauth-url.mjs
// NetAmplify — Build the Instagram OAuth URL and verify it accepts the redirect URI.
//
// This script:
//   1. Reads INSTAGRAM_APP_ID + PUBLIC_APP_URL from .env
//   2. Builds the Instagram authorize URL (same as the adapter does)
//   3. Sends a HEAD request to Instagram to verify the redirect URI is accepted
//      (Instagram returns 302 on success, 400 with "Invalid redirect URI" on failure)
//   4. Prints the URL the user should visit to start the OAuth flow manually
//
// Run with: node scripts/verify-instagram-oauth-url.mjs

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';

const ENV_PATH = resolve(process.cwd(), '.env');

if (!existsSync(ENV_PATH)) {
  console.log(`❌ No .env file found at: ${ENV_PATH}`);
  process.exit(1);
}

const env = parse(readFileSync(ENV_PATH, 'utf-8'));
const appId = env.INSTAGRAM_APP_ID || process.env.INSTAGRAM_APP_ID;
const publicAppUrl = env.PUBLIC_APP_URL || process.env.PUBLIC_APP_URL;

if (!appId) {
  console.log('❌ INSTAGRAM_APP_ID is not set in .env');
  process.exit(1);
}
if (!publicAppUrl) {
  console.log('❌ PUBLIC_APP_URL is not set in .env');
  process.exit(1);
}

const redirectUri = `${publicAppUrl}/api/oauth/instagram/callback`;
const state = 'diagnostic-test-state';
const scope = 'instagram_business_basic,instagram_business_content_publish';

const params = new URLSearchParams({
  client_id: appId,
  redirect_uri: redirectUri,
  state,
  scope,
  response_type: 'code',
});

const authUrl = `https://api.instagram.com/oauth/authorize?${params.toString()}`;

console.log('═'.repeat(72));
console.log('  NetAmplify — Instagram OAuth URL Verifier');
console.log('═'.repeat(72));
console.log(`\nINSTAGRAM_APP_ID : ${appId}`);
console.log(`PUBLIC_APP_URL   : ${publicAppUrl}`);
console.log(`Redirect URI     : ${redirectUri}`);
console.log(`Scopes           : ${scope}\n`);

console.log('─── Verifying redirect URI with Instagram ──────────────────');
console.log('(Sending HEAD request to api.instagram.com/oauth/authorize)\n');

try {
  const resp = await fetch(authUrl, { method: 'GET', redirect: 'manual' });

  if (resp.status === 302 || resp.status === 303) {
    const location = resp.headers.get('location') || '';
    if (location.includes('code=')) {
      console.log('✅ Instagram accepted the redirect URI!');
      console.log('   (Got 302 redirect with a code — would normally go to your callback.)');
    } else if (location.includes('error')) {
      console.log(`⚠️  Instagram returned a 302 to an error URL: ${location}`);
      console.log('   This usually means the user needs to authorize the app first.');
    } else {
      console.log(`✅ Instagram returned 302 (Location: ${location || 'none'})`);
      console.log('   Redirect URI is valid. The user will see Instagram\'s login page.');
    }
  } else if (resp.status === 400) {
    const text = await resp.text();
    console.log(`❌ Instagram rejected the redirect URI (400).`);
    console.log(`   Response body: ${text}`);
    console.log('\n   Common causes:');
    console.log('   - The redirect URI is NOT added to your Meta dashboard');
    console.log('     (Instagram API → Set up Instagram business login → Redirect URIs)');
    console.log('   - The redirect URI has a typo or trailing slash');
    console.log('   - The app is in Development mode and you\'re not a tester');
  } else if (resp.status === 200) {
    console.log(`✅ Instagram returned 200 (login page HTML).`);
    console.log('   This means the redirect URI was accepted and Instagram is showing');
    console.log('   the login page. The OAuth flow is correctly configured.');
  } else {
    console.log(`⚠️  Unexpected status: ${resp.status}`);
    const text = await resp.text().catch(() => '(no body)');
    console.log(`   Body: ${text.slice(0, 200)}`);
  }
} catch (e) {
  console.log(`❌ Network error: ${e.message}`);
}

console.log('\n─── Manual test URL ────────────────────────────────────────');
console.log('Open this URL in your browser to start the OAuth flow manually:');
console.log('\n' + authUrl + '\n');
console.log('═'.repeat(72));
