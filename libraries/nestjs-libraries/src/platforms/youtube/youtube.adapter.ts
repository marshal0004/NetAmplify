// /home/z/my-project/netamplify-ref/libraries/nestjs-libraries/src/platforms/youtube/youtube.adapter.ts
// NetAmplify — YouTube adapter (official Google Data API v3).
//
// Uses the official YouTube Data API v3 — OAuth 2.0 + resumable video upload.
// This is the FREE, legitimate, non-paywall-bypassing integration: YouTube
// Data API v3 has a free quota of 10,000 units/day per project (a video
// upload costs 1600 units → ~6 uploads/day free, plenty for NetAmplify's
// per-user publish volume).
//
// API docs:
//   OAuth:   https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
//   Upload:  https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
//   Channels: https://developers.google.com/youtube/v3/docs/channels/list
//
// IMPORTANT — YouTube Data API v3 supports ONLY video uploads. There is no
// "text status" or "community post" endpoint in the public API (the community
// tab is internal to YouTube). So this adapter REQUIRES a video URL via
// formatted.options.videoUrl. A PostCard without a video cannot be published
// to YouTube — the publish() method throws a clear VALIDATION error.
//
// OAuth flow:
//   1. Browser → https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&scope=...
//      (access_type=offline + prompt=consent → guarantees a refresh token)
//   2. User authorizes on Google
//   3. Google → redirect_uri?code=...&state=...
//   4. Backend POSTs to https://oauth2.googleapis.com/token
//      → { access_token, refresh_token, expires_in, scope, token_type }
//   5. Backend fetches channel id + title via
//      GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true
//
// Publishing flow (resumable upload, two HTTP calls):
//   1. Initiate session:
//      POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//      Headers: Authorization: Bearer {token}, Content-Type: application/json
//      Body: { snippet: { title, description, tags }, status: { privacyStatus: 'public' } }
//      → 200 with empty body, Location: {session-uri} header
//   2. Upload bytes:
//      PUT {session-uri}
//      Headers: Content-Type: {video_mime}
//      Body: <raw video bytes>
//      → 200 with { id: videoId, snippet: {...}, status: {...} }
//   3. Return { id: videoId, url: https://youtu.be/{videoId} }
//
// The backend itself fetches the video bytes from formatted.options.videoUrl
// (Google does NOT fetch the URL — unlike Instagram/Threads where Meta fetches
// the image). So localhost video URLs work in dev WITHOUT ngrok: the backend
// loopback-fetches its own uploads. If PUBLIC_APP_URL is set and the video URL
// is localhost, we rewrite to PUBLIC_APP_URL so the upload still works when the
// backend runs on a different host than the upload store (production split).
//
// Google access tokens expire in 1 hour. The refresh() method exchanges the
// stored refresh_token for a new access_token — called by the publish worker
// before publish if the token expires within the next 5 minutes.

import { Injectable } from '@nestjs/common';
import type {
  PlatformAdapter,
  PkcePair,
  OAuthTokens,
  PlatformIdentity,
  AdapterCredentials,
  FormattedPost,
  PublishResult,
} from '../adapter.interface';
import { PublishError } from '../adapter.interface';
import type { Platform } from '@prisma/client';
import { isVideoMedia, readLocalUploadFile } from '../../services/uploads-dir';

// Google OAuth endpoints.
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// YouTube Data API v3 endpoints.
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

// YouTube Data API v3 scopes (minimal per trust model).
//
//   youtube.upload   — upload videos (initiate resumable session + PUT bytes)
//   youtube.readonly — channels.list?mine=true for identity (channel id + title)
//
// youtube.force-ssl (comments) and yt-analytics.readonly (metrics) are NOT
// requested: the MVP only uploads videos. Add them when those features ship.
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

/** YouTube video title limit (100 chars per Data API docs). */
const YOUTUBE_TITLE_LIMIT = 100;
/** YouTube video description limit (5000 chars per Data API docs). */
const YOUTUBE_DESC_LIMIT = 5000;
/** Max total tags length (500 chars per Data API docs). */
const YOUTUBE_TAGS_LIMIT = 500;
/** Max tags count (YouTube accepts up to 30, but 10 is the realistic cap). */
const YOUTUBE_MAX_TAGS = 10;

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for YouTube.
 *
 * saveOAuthConnection() stores identity.id as both `memberId` and `userId`,
 * so the channel id is read from channelId / memberId / userId.
 */
export interface YouTubeCredentials extends AdapterCredentials {
  /** Google OAuth access token (1h expiry — refreshable). */
  accessToken: string;
  /** Google OAuth refresh token (long-lived — used to refresh access tokens). */
  refreshToken?: string;
  /** YouTube channel id (UC... format — fetched via channels.list?mine=true). */
  channelId?: string;
  /** Channel display name (for permalink construction). */
  channelTitle?: string;
}

@Injectable()
export class YouTubeAdapter implements PlatformAdapter {
  readonly platform: Platform = 'YOUTUBE';
  readonly name = 'YouTube';
  readonly toolTip = 'Connect your YouTube channel (Google OAuth)';
  readonly kind = 'OAUTH' as const;

  /**
   * Returns true when YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET are set.
   * These come from a Google Cloud Console OAuth client (Web application type).
   */
  configured(): boolean {
    return Boolean(
      process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET,
    );
  }

  /**
   * Build the Google OAuth authorize URL.
   *
   * Google supports PKCE (S256) — we include code_challenge to match
   * NetAmplify's PKCE-first security model (defense in depth even though
   * Google also requires client_secret at exchange for confidential clients).
   *
   * access_type=offline + prompt=consent GUARANTEES a refresh token is
   * returned on the first authorization. Without these, Google only returns
   * a refresh token the very first time a user consents — subsequent logins
   * return access_token only, forcing reconnect every hour. Always setting
   * prompt=consent is the robust production choice.
   *
   * Google ACCEPTS http://localhost redirect URIs (unlike Meta/Threads), so
   * this adapter does NOT enforce HTTPS — the oauth-redirect.ts helper routes
   * YOUTUBE to the request-origin branch (localhost OK in dev).
   */
  getAuthUrl(pkce: PkcePair, state: string, redirectUri: string): string {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        'YouTube adapter not configured (missing YOUTUBE_CLIENT_ID). ' +
          'Add YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET to .env. ' +
          'Create an OAuth 2.0 Client ID (Web application type) in Google Cloud Console.',
      );
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: YOUTUBE_SCOPES.join(' '),
      state,
      // PKCE (S256) — Google supports it; matches NetAmplify's security model.
      code_challenge: pkce.code_challenge,
      code_challenge_method: pkce.code_challenge_method,
      // Force a refresh token to always be returned.
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for Google OAuth tokens.
   *
   * Google requires client_secret for confidential (web) clients at exchange,
   * EVEN when PKCE is used. The body includes both code_verifier (PKCE) and
   * client_secret — standard Google server-side web app flow.
   *
   * Returns access_token (1h) + refresh_token (long-lived) + scopes.
   */
  async exchangeCode(
    code: string,
    pkce: PkcePair,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new PublishError(
        'AUTH',
        'YouTube adapter not configured (missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET)',
      );
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: pkce.code_verifier,
    });

    const resp = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (resp.status === 401 || resp.status === 400) {
      const text = await resp.text();
      throw new PublishError('AUTH', `YouTube code exchange failed: ${text}`);
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `YouTube token exchange failed (${resp.status}): ${text}`,
      );
    }

    const data = (await resp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    if (!data.access_token) {
      throw new PublishError('AUTH', 'YouTube returned no access_token');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : Math.floor(Date.now() / 1000) + 3600,
      scopes: data.scope ? data.scope.split(' ') : YOUTUBE_SCOPES,
    };
  }

  /**
   * Fetch the YouTube channel identity (channel id + title).
   *
   * Uses channels.list?part=snippet&mine=true with the access token. The
   * channel id (UC...) is the platformAccountId. The channel title is used
   * as the display username.
   */
  async getIdentity(tokens: OAuthTokens): Promise<PlatformIdentity> {
    const url = new URL(`${YOUTUBE_API_BASE}/channels`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    if (resp.status === 401) {
      throw new PublishError('AUTH', 'YouTube access token invalid or expired');
    }
    if (resp.status === 403) {
      const text = await resp.text();
      throw new PublishError(
        'AUTH',
        `YouTube forbidden: ${text}. The YouTube Data API v3 may not be enabled ` +
          `in the Google Cloud project, or the OAuth consent screen is in testing ` +
          `(add the user as a test user).`,
      );
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `YouTube /channels failed (${resp.status}): ${text}`,
      );
    }

    const data = (await resp.json()) as {
      items?: Array<{
        id: string;
        snippet: { title: string; customUrl?: string };
      }>;
    };

    if (!data.items || data.items.length === 0) {
      throw new PublishError(
        'AUTH',
        'YouTube returned no channel for this account — the Google account may ' +
          'not have a YouTube channel. Create one at youtube.com first.',
      );
    }

    const channel = data.items[0];
    const username = channel.snippet.customUrl
      ? `@${channel.snippet.customUrl}`
      : channel.snippet.title || `YouTube channel ${channel.id}`;

    return {
      id: channel.id,
      username,
    };
  }

  /**
   * Refresh a Google OAuth access token (1h expiry → fresh 1h token).
   *
   * Google refresh tokens are long-lived (effectively permanent unless
   * revoked). The refresh endpoint is the same as the token endpoint, with
   * grant_type=refresh_token. Returns a NEW access_token; the refresh_token
   * itself is NOT returned (it stays the same — keep using the stored one).
   *
   * Called by the publish worker before publish if the access token expires
   * within the next 5 minutes (proactive refresh avoids mid-upload AUTH
   * failures, which would waste the resumable session).
   */
  async refresh(tokens: OAuthTokens): Promise<OAuthTokens> {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new PublishError('AUTH', 'YouTube adapter not configured (missing client credentials)');
    }
    if (!tokens.refreshToken) {
      throw new PublishError(
        'AUTH',
        'Cannot refresh YouTube token: no refresh_token stored. User must reconnect ' +
          '(the prior OAuth flow may not have requested offline access).',
      );
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const resp = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (resp.status === 401 || resp.status === 400) {
      throw new PublishError(
        'AUTH',
        'YouTube refresh token invalid or revoked — user must reconnect',
      );
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `YouTube token refresh failed (${resp.status}): ${text}`,
      );
    }

    const data = (await resp.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!data.access_token) {
      throw new PublishError('NETWORK', 'YouTube refresh returned no access_token');
    }

    return {
      accessToken: data.access_token,
      // Google does NOT return a new refresh_token on refresh — keep the old one.
      refreshToken: tokens.refreshToken,
      expiresAt: data.expires_in
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : Math.floor(Date.now() / 1000) + 3600,
      scopes: data.scope ? data.scope.split(' ') : tokens.scopes ?? YOUTUBE_SCOPES,
    };
  }

  /**
   * Refresh the stored Google OAuth credentials if the access token is near
   * expiry. Implements PlatformAdapter.refreshCredentials — called by the
   * publish worker before publish().
   *
   * Google access tokens expire in 1 hour. Without this refresh, every publish
   * more than 1h after the OAuth dance fails with 401 → AUTH → the connection
   * is marked REVOKED + the user must reconnect. This was the #1 cause of
   * YouTube "failed completely" with no visible error in the logs — the AUTH
   * branch in the worker silently returned without logging.
   *
   * Google refresh tokens are long-lived (effectively permanent unless revoked)
   * and are NOT rotated on refresh — so we keep using the stored refresh_token.
   * Returns the SAME blob reference when the token is still valid (worker skips
   * re-encrypt + persist). Preserves channelId / channelTitle / memberId.
   *
   * Throws AUTH if there is no refresh_token (prior OAuth didn't request
   * offline access) or the refresh_token is revoked (user reconnects).
   */
  async refreshCredentials(credentials: AdapterCredentials): Promise<AdapterCredentials> {
    const creds = credentials as YouTubeCredentials & {
      expiresAt?: number;
      scopes?: string[];
      memberId?: string;
      userId?: string;
    };
    if (!creds.accessToken) {
      throw new PublishError('AUTH', 'Cannot refresh YouTube token: no access token');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    // >5min of life left — no refresh needed (return same ref → worker skips persist).
    if (creds.expiresAt && creds.expiresAt - nowSec > 300) {
      return credentials;
    }
    // expiring/expired OR no expiresAt stored (older connection — Google tokens
    // are 1h so an unknown-age token is almost certainly stale) → refresh now.
    const refreshed = await this.refresh({
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      scopes: creds.scopes,
    });
    // Preserve non-token fields (channelId, channelTitle, memberId, userId).
    // Google does NOT return a new refresh_token — keep the stored one.
    return {
      ...creds,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? creds.refreshToken,
      expiresAt: refreshed.expiresAt,
      scopes: refreshed.scopes ?? creds.scopes,
    };
  }

  /**
   * Publish a video to YouTube via the resumable upload protocol.
   *
   * REQUIRES formatted.options.videoUrl (YouTube Data API v3 has no text-only
   * post endpoint). The backend fetches the video bytes from that URL and
   * pushes them to Google's resumable upload endpoint.
   *
   * Title (≤100), description (≤5000), and tags (≤500 total) are built from
   * formatted.title / formatted.body / formatted.hashtags.
   *
   * Two HTTP calls:
   *   1. POST .../videos?uploadType=resumable&part=snippet,status with JSON
   *      metadata → 200 + Location header (session URI)
   *   2. PUT {session-uri} with raw video bytes → 200 + { id: videoId }
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost,
  ): Promise<PublishResult> {
    const creds = credentials as YouTubeCredentials;
    if (!creds.accessToken) {
      throw new PublishError(
        'AUTH',
        'YouTube access token missing — user must reconnect',
      );
    }

    // The PostCard stores a single `imageUrl` that holds BOTH images + videos
    // (the upload controller accepts .jpg/.png/.gif/.webp/.mp4). YouTube Data
    // API v3 ONLY accepts video uploads (no text/image post endpoint), so we
    // read formatted.options.imageUrl + require it to be a video file.
    const rawMediaUrl = formatted.options?.imageUrl as string | undefined;
    if (!rawMediaUrl || typeof rawMediaUrl !== 'string') {
      throw new PublishError(
        'VALIDATION',
        'YouTube posts require a video. Upload a video (.mp4, .webm, or .mov) in the ' +
          'PostCard editor. YouTube Data API v3 has no text-only or image post endpoint.',
      );
    }
    if (!isVideoMedia(rawMediaUrl)) {
      throw new PublishError(
        'VALIDATION',
        `YouTube requires a VIDEO file (.mp4/.webm/.mov). The PostCard media URL is not ` +
          `a video: ${rawMediaUrl}. Upload a video instead of an image.`,
      );
    }

    // Build video metadata (title + description + tags).
    const title = truncate(formatted.title, YOUTUBE_TITLE_LIMIT) || 'Untitled';
    const description = buildDescription(formatted, YOUTUBE_DESC_LIMIT);
    const tags = buildTags(formatted.hashtags, YOUTUBE_TAGS_LIMIT, YOUTUBE_MAX_TAGS);

    // Step 1: Initiate the resumable upload session.
    const initiateUrl = new URL(`${YOUTUBE_UPLOAD_BASE}/videos`);
    initiateUrl.searchParams.set('uploadType', 'resumable');
    initiateUrl.searchParams.set('part', 'snippet,status');

    const metadataPayload = {
      snippet: { title, description, tags, categoryId: '22' }, // 22 = People & Blogs
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    };

    const initiateResp = await fetch(initiateUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        // Google requires the upload protocol header to accept the Location.
        'X-Upload-Content-Type': 'video/*',
      },
      body: JSON.stringify(metadataPayload),
    });

    if (initiateResp.status === 401) {
      throw new PublishError('AUTH', 'YouTube access token expired — user must reconnect');
    }
    if (initiateResp.status === 403) {
      const text = await initiateResp.text();
      throw new PublishError(
        'AUTH',
        `YouTube upload forbidden: ${text}. The YouTube Data API v3 may not be enabled ` +
          `or the OAuth consent screen is in testing (add the user as a test user).`,
      );
    }
    if (initiateResp.status === 429) {
      throw new PublishError('RATE', 'YouTube API quota exceeded (10,000 units/day) — try again tomorrow');
    }
    if (!initiateResp.ok) {
      const text = await initiateResp.text();
      throw new PublishError(
        'NETWORK',
        `YouTube resumable initiate failed (${initiateResp.status}): ${text}`,
      );
    }

    const sessionUri = initiateResp.headers.get('location');
    if (!sessionUri) {
      throw new PublishError(
        'NETWORK',
        'YouTube resumable initiate returned no Location header (session URI)',
      );
    }

    // Step 2: Get the video bytes + upload them to the session URI.
    //
    // Read the LOCAL file from disk FIRST — this bypasses the ngrok/404/
    // interstitial roundtrip entirely (the backend loopback-fetching its own
    // ngrok URL is fragile + was returning 404, and ngrok-free serves an HTML
    // "Visit Site" interstitial to non-browser User-Agents like Node fetch).
    // If the URL isn't a local /uploads/ URL (external CDN), fall back to HTTP
    // fetch with the ngrok-skip-browser-warning header.
    let videoBytes: ArrayBuffer;
    let videoMime: string;
    const localFile = readLocalUploadFile(rawMediaUrl);
    if (localFile) {
      // Buffer → ArrayBuffer slice (fetch accepts Buffer directly, but
      // ArrayBuffer is the canonical byte-upload body type).
      videoBytes = localFile.buffer.slice(
        localFile.byteOffset,
        localFile.byteOffset + localFile.byteLength,
      ) as ArrayBuffer;
      videoMime = inferMimeFromUrl(rawMediaUrl) || 'video/mp4';
    } else {
      const resolvedVideoUrl = resolveVideoUrl(rawMediaUrl);
      try {
        const videoResp = await fetch(resolvedVideoUrl, {
          headers: { 'ngrok-skip-browser-warning': 'skip' },
        });
        if (!videoResp.ok) {
          throw new PublishError(
            'NETWORK',
            `Could not fetch video bytes from ${resolvedVideoUrl} (${videoResp.status})`,
          );
        }
        videoBytes = await videoResp.arrayBuffer();
        videoMime =
          videoResp.headers.get('content-type') ||
          inferMimeFromUrl(resolvedVideoUrl) ||
          'video/mp4';
      } catch (e) {
        if (e instanceof PublishError) throw e;
        throw new PublishError(
          'NETWORK',
          `Failed to fetch video bytes from ${resolvedVideoUrl}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (videoBytes.byteLength === 0) {
      throw new PublishError('VALIDATION', `Video file is empty (0 bytes)`);
    }

    // PUT the raw bytes to the session URI.
    const uploadResp = await fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Type': videoMime },
      body: videoBytes,
    });

    if (uploadResp.status === 401) {
      throw new PublishError('AUTH', 'YouTube access token expired during upload');
    }
    if (uploadResp.status === 413) {
      throw new PublishError(
        'VALIDATION',
        'Video file too large — YouTube limit is 256MB. Compress or trim the video.',
      );
    }
    if (!uploadResp.ok) {
      const text = await uploadResp.text();
      throw new PublishError(
        'NETWORK',
        `YouTube resumable upload failed (${uploadResp.status}): ${text}`,
      );
    }

    const uploadData = (await uploadResp.json()) as {
      id?: string;
      error?: { message: string; errors?: Array<{ reason: string }> };
    };

    if (uploadData.error) {
      throw new PublishError(
        'VALIDATION',
        `YouTube rejected video: ${uploadData.error.message}`,
      );
    }
    if (!uploadData.id) {
      throw new PublishError('NETWORK', 'YouTube upload returned no video id');
    }

    return {
      id: uploadData.id,
      url: `https://youtu.be/${uploadData.id}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing).
// ---------------------------------------------------------------------------

/**
 * Resolve the video URL the backend will fetch.
 *
 * Unlike Instagram/Threads (where Meta's servers fetch the image — localhost
 * unreachable), for YouTube the BACKEND itself fetches the video bytes. So
 * localhost URLs work in dev via loopback. But if PUBLIC_APP_URL is set and
 * the video URL is localhost, we rewrite to PUBLIC_APP_URL so the fetch works
 * even when the backend runs on a different host than the upload store
 * (production split-tier deploy). If PUBLIC_APP_URL is unset, we keep the
 * localhost URL — the backend loopback-fetches its own uploads.
 *
 * Examples:
 *   resolveVideoUrl('https://cdn.example.com/v.mp4')        → unchanged
 *   resolveVideoUrl('http://localhost:3000/v.mp4') + no env  → unchanged (loopback)
 *   resolveVideoUrl('http://localhost:3000/v.mp4') + env     → https://{env}/v.mp4
 */
export function resolveVideoUrl(url: string): string {
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
    return url;
  }
  const publicAppUrl = process.env.PUBLIC_APP_URL;
  if (!publicAppUrl) {
    return url; // backend loopback-fetch — fine for dev / single-host prod.
  }
  try {
    const parsed = new URL(url);
    const publicParsed = new URL(publicAppUrl);
    return `${publicParsed.protocol}//${publicParsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return url; // malformed URL — let fetch() throw a clear error downstream.
  }
}

/**
 * Truncate a string to `max` chars, appending an ellipsis if truncated.
 */
function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Build the YouTube video description from the formatted post body + url.
 *
 * Description = body (truncated to DESC_LIMIT) + optional url on its own line.
 */
function buildDescription(formatted: FormattedPost, limit: number): string {
  const urlLine = formatted.url ? `\n\n${formatted.url}` : '';
  const raw = `${formatted.body}${urlLine}`;
  return truncate(raw, limit);
}

/**
 * Build the YouTube tags array from the formatted post hashtags.
 *
 * YouTube tags: each ≤100 chars, total ≤500 chars, max 10 tags. We lowercase
 * + strip non-alphanumerics (YouTube rejects tags with special chars).
 */
function buildTags(
  hashtags: string[] | undefined,
  totalLimit: number,
  maxCount: number,
): string[] {
  if (!hashtags || hashtags.length === 0) return [];
  const cleaned = hashtags
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 0 && t.length <= 100)
    .slice(0, maxCount);
  // Enforce total length budget (sum of all tag lengths).
  const result: string[] = [];
  let total = 0;
  for (const t of cleaned) {
    if (total + t.length > totalLimit) break;
    result.push(t);
    total += t.length;
  }
  return result;
}

/**
 * Infer a video MIME type from the URL file extension.
 *
 * Fallback when the fetch response has no Content-Type header.
 */
function inferMimeFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.mp4')) return 'video/mp4';
    if (path.endsWith('.webm')) return 'video/webm';
    if (path.endsWith('.mov')) return 'video/quicktime';
    if (path.endsWith('.avi')) return 'video/x-msvideo';
    if (path.endsWith('.mkv')) return 'video/x-matroska';
    return null;
  } catch {
    return null;
  }
}
