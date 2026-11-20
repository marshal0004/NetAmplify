// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/bluesky/bluesky.adapter.ts
// NetAmplify — Bluesky adapter.
//
// SIMPLE credential: user creates an App Password in bsky.app/settings,
// then pastes their handle + app password. We validate by creating a
// session via the AT Protocol (com.atproto.server.createSession).
//
// AT Protocol docs: https://atproto.com/specs/xrpc
//
// Trust model per docs/12-TRUST-COPY.md §1:
//   "Bluesky built App Passwords exactly for this: separate from your
//    real password, limited to posting, revocable in one click."
//
// Per docs/02-SRS.md FR-008: validate by createSession; reject with clear
// message on invalid pair.

import { Injectable } from '@nestjs/common';
import type {
  PlatformAdapter,
  PlatformIdentity,
  AdapterCredentials,
  FormattedPost,
  PublishResult,
} from '../adapter.interface';
import { PublishError } from '../adapter.interface';
import type { Platform } from '@prisma/client';
import { isVideoMedia, readLocalUploadFile } from '../../services/uploads-dir';

const BLUESKY_PDS_BASE = 'https://bsky.social/xrpc';
const BLUESKY_PUBLIC_BASE = 'https://public.api.bsky.app/xrpc';

/**
 * Bluesky's video processing service (separate from the PDS). Video blobs
 * are uploaded here for async transcoding, then polled until the job
 * completes — the resulting blob ref goes into the post's video embed.
 *
 * Docs: https://atproto.com/lexicons/app-bsky-video
 */
const BLUESKY_VIDEO_BASE = 'https://video.bsky.app/xrpc';

/**
 * Bluesky rejects image blobs larger than 1,000,000 bytes (1 MB). Per
 * postflare's provider + the AT Protocol spec. Images larger than this must
 * be resized before upload — the adapter uses sharp for that (see
 * uploadImageBlob).
 */
const MAX_IMAGE_BYTES = 1_000_000;

/**
 * MIME types Bluesky accepts for image embeds. Per the app.bsky.embed.images
 * lexicon + postflare's IMAGE_MIMES list.
 */
const BLUESKY_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/**
 * Maps file extensions to MIME types. Used when uploading local /uploads/
 * files to Bluesky — the upload endpoint requires the correct Content-Type
 * header (Bluesky validates the blob mimeType against the embed's expected
 * type).
 */
const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for Bluesky.
 */
export interface BlueskyCredentials extends AdapterCredentials {
  /** Session access JWT (1h expiry, refreshed via refreshJwt) */
  accessJwt: string;
  /** Session refresh JWT (used to refresh accessJwt) */
  refreshJwt: string;
  /** The user's DID (decentralized identifier) */
  did: string;
  /** The user's handle (e.g. "jane.bsky.social") */
  handle: string;
}

interface CreateSessionResponse {
  did: string;
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  email?: string;
}

/**
 * Decode the `exp` (expiry, epoch seconds) claim from a Bluesky JWT.
 *
 * Bluesky access JWTs are standard JWS compact tokens: header.payload.signature,
 * base64url-encoded. The payload carries `exp` (seconds), `iat`, `scope`, `sub`
 * (the user's DID). We read `exp` to decide whether the token needs refreshing
 * before publish — Bluesky access tokens expire in ~hours, so a connection
 * stored yesterday is almost certainly expired today.
 *
 * Returns null if the JWT is malformed or has no `exp` (caller treats null as
 * "refresh proactively" — safer than assuming validity).
 */
function decodeJwtExp(jwt: string): number | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64.padEnd(
      payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(
      Buffer.from(padded, 'base64').toString('utf8'),
    ) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Decode the `aud` (audience) claim from a Bluesky access JWT.
 *
 * The access JWT's `aud` is the DID of the PDS that issued the token — i.e.
 * the user's PDS. This is NOT always `did:web:bsky.social`: Bluesky hosts
 * users across multiple PDS instances (e.g. fibercap.us-west.host.bsky.network).
 *
 * The video service requires the service JWT's `aud` to match the user's PDS
 * DID (NOT the video service's DID) — it uses `aud` to identify which PDS
 * minted the token. Without the correct PDS DID, the video service returns:
 *   "invalid token audience ..., should be the user's PDS DID ..."
 *
 * Returns null if the JWT is malformed or has no `aud`.
 */
function decodeJwtAud(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64.padEnd(
      payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(
      Buffer.from(padded, 'base64').toString('utf8'),
    ) as { aud?: string };
    return typeof payload.aud === 'string' ? payload.aud : null;
  } catch {
    return null;
  }
}

/**
 * Convert a PDS DID to its HTTPS URL.
 *
 *  - did:web:fibercap.us-west.host.bsky.network → https://fibercap.us-west.host.bsky.network
 *  - did:plc:xxx → resolved via the PLC directory (https://plc.directory/did:plc:xxx),
 *    extracting service[0].serviceEndpoint. Returns null if resolution fails.
 *
 * Most Bluesky PDS DIDs are did:web (bsky.social, fibercap, etc.). did:plc
 * PDS DIDs are rare but handled for completeness.
 */
async function resolvePdsUrl(pdsDid: string): Promise<string | null> {
  if (pdsDid.startsWith('did:web:')) {
    return `https://${pdsDid.slice('did:web:'.length)}`;
  }
  if (pdsDid.startsWith('did:plc:')) {
    try {
      const resp = await fetch(`https://plc.directory/${pdsDid}`);
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        service?: Array<{ serviceEndpoint?: string }>;
      };
      return data.service?.[0]?.serviceEndpoint ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

@Injectable()
export class BlueskyAdapter implements PlatformAdapter {
  readonly platform: Platform = 'BLUESKY';
  readonly name = 'Bluesky';
  readonly toolTip = 'Paste your handle + App Password';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    return true;
  }

  /**
   * Validate the user-pasted handle + app password by creating a session.
   * Per docs/02-SRS.md FR-008: server creates a session via bsky.app
   * protocol (createSession) → store credentials encrypted.
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: BlueskyCredentials }> {
    const handle = input.handle;
    const appPassword = input.appPassword;
    if (!handle || typeof handle !== 'string') {
      throw new PublishError('VALIDATION', 'handle is required');
    }
    if (!appPassword || typeof appPassword !== 'string') {
      throw new PublishError('VALIDATION', 'appPassword is required');
    }

    const resp = await fetch(`${BLUESKY_PDS_BASE}/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'Bluesky rejected these credentials — create the app password in Settings → App passwords'
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Bluesky rate-limited — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Bluesky createSession failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as CreateSessionResponse & {
      error?: string;
      message?: string;
    };
    if (data.error) {
      throw new PublishError('AUTH', `Bluesky rejected: ${data.message || data.error}`);
    }

    return {
      identity: {
        id: data.did,
        username: data.handle,
      },
      credentials: {
        accessJwt: data.accessJwt,
        refreshJwt: data.refreshJwt,
        did: data.did,
        handle: data.handle,
      },
    };
  }

  /**
   * Refresh the Bluesky session if the accessJwt is near expiry.
   *
   * Implements PlatformAdapter.refreshCredentials — called by the publish
   * worker before publish(). Bluesky access tokens expire in ~hours; without
   * this refresh, EVERY publish after the accessJwt lapses fails with
   * ExpiredToken (HTTP 400, not 401) — which was the root cause of the Bluesky
   * publish failures + the "stuck publishing" loop in the original logs.
   *
   * Flow:
   *   1. Decode the accessJwt `exp`. If exp is >5min in the future, return the
   *      SAME blob reference (worker skips re-encrypt + persist — cheap).
   *   2. Otherwise POST com.atproto.server.refreshSession with the refreshJwt
   *      → new accessJwt + new refreshJwt.
   *   3. Return a new blob preserving did/handle (same account).
   *
   * Bluesky ROTATES the refresh token — the new refreshJwt MUST be persisted
   * (the worker does this via ConnectionRepository.updateCredentials) or every
   * subsequent refresh will use the now-invalidated old refreshJwt + fail.
   *
   * Throws AUTH if the refreshJwt itself is invalid/revoked (user reconnects).
   */
  async refreshCredentials(credentials: AdapterCredentials): Promise<AdapterCredentials> {
    const creds = credentials as BlueskyCredentials;
    if (!creds.accessJwt || !creds.refreshJwt) {
      throw new PublishError(
        'AUTH',
        'Cannot refresh Bluesky session: missing accessJwt or refreshJwt',
      );
    }
    const exp = decodeJwtExp(creds.accessJwt);
    const nowSec = Math.floor(Date.now() / 1000);
    // If we can decode exp AND the token still has >5min of life, skip refresh.
    if (exp !== null && exp - nowSec > 300) {
      return credentials;
    }
    // exp missing (malformed JWT) OR token expiring/expired → refresh now.
    const resp = await fetch(`${BLUESKY_PDS_BASE}/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.refreshJwt}`,
        'Content-Type': 'application/json',
      },
    });
    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'Bluesky refresh token invalid or revoked — user must reconnect',
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Bluesky rate-limited during refresh — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Bluesky refreshSession failed (${resp.status}): ${text}`,
      );
    }
    const data = (await resp.json()) as CreateSessionResponse;
    if (!data.accessJwt || !data.refreshJwt) {
      throw new PublishError(
        'NETWORK',
        'Bluesky refreshSession returned no accessJwt/refreshJwt',
      );
    }
    // Preserve did/handle (refresh is for the SAME account). The new refreshJwt
    // is persisted by the worker — without that, the next refresh would reuse
    // the now-rotated old refreshJwt + fail.
    return {
      ...creds,
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
      did: data.did ?? creds.did,
      handle: data.handle ?? creds.handle,
    };
  }

  /**
   * Publish a post to Bluesky via com.atproto.repo.createRecord.
   *
   * Per docs/02-SRS.md FR-011: ≤300 chars (graphemes) + external link facet.
   *
   * Bluesky posts are records in the user's repository. Each post is a
   * JSON object with $type: 'app.bsky.feed.post', text, and optional facets
   * for links + mentions.
   *
   * Docs: https://atproto.com/lexicons/com-atproto-repo#create-record
   *       https://atproto.com/lexicons/app-bsky-feed-post
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as BlueskyCredentials;
    if (!creds.accessJwt || !creds.did) {
      throw new PublishError('AUTH', 'Bluesky access token or DID missing from credentials');
    }

    // The format-engine (blueskyFormatter) already builds the COMPLETE post
    // text — title + summary + description + URL + hashtags — and truncates
    // it to ≤300 graphemes. The adapter uses formatted.body directly as the
    // post text. Previously, the adapter RE-concatenated title + body + URL +
    // hashtags on top of the already-complete formatted.body, duplicating
    // everything and pushing the text over the 300-grapheme limit.
    const text = formatted.body;

    // Safety net: the formatter truncates to 300, but verify before sending
    // (Bluesky hard-rejects posts >300 graphemes with a 400).
    const graphemeCount = countGraphemes(text);
    if (graphemeCount > 300) {
      throw new PublishError(
        'VALIDATION',
        `Bluesky post exceeds 300 graphemes (got ${graphemeCount}) — ` +
          `the format-engine should have truncated to 300. Check the blueskyFormatter.`,
      );
    }

    // Build facets for the URL (so Bluesky renders it as a clickable link).
    // The URL is already inside formatted.body (the formatter included it),
    // so text.indexOf finds it and we build the byte-offset facet for it.
    const facets: unknown[] = [];
    if (formatted.url) {
      const urlStart = text.indexOf(formatted.url);
      if (urlStart >= 0) {
        const urlEnd = urlStart + formatted.url.length;
        // Convert UTF-16 offsets to UTF-8 byte offsets (Bluesky uses byte offsets)
        const byteStart = utf16ToUtf8ByteOffset(text, urlStart);
        const byteEnd = utf16ToUtf8ByteOffset(text, urlEnd);
        facets.push({
          $type: 'app.bsky.richtext.facet',
          index: { byteStart, byteEnd },
          features: [
            {
              $type: 'app.bsky.richtext.facet#link',
              uri: formatted.url,
            },
          ],
        });
      }
    }

    // Media embed — Bluesky posts can carry images (app.bsky.embed.images)
    // or a video (app.bsky.embed.video). The format-engine merges the
    // PostCard's imageUrl into formatted.options.imageUrl; the per-platform
    // options panel can set formatted.options.altText for image accessibility.
    //
    // Without this block, Bluesky posts went out text-only even when the
    // PostCard had an image/video attached — the adapter simply ignored
    // the media URL. Now: read the bytes (local disk for /uploads/ files,
    // HTTP fetch for external URLs), upload as a blob, and embed it.
    const mediaUrl = formatted.options?.imageUrl as string | undefined;
    let embed: unknown | undefined;
    if (mediaUrl) {
      if (isVideoMedia(mediaUrl)) {
        embed = await this.uploadVideoEmbed(mediaUrl, creds.accessJwt, creds.did);
      } else {
        const altText =
          (formatted.options?.altText as string | undefined) ?? '';
        embed = await this.uploadImageEmbed(mediaUrl, creds.accessJwt, altText);
      }
    }

    // Create the record
    const createRecordBody = {
      repo: creds.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
        ...(facets.length > 0 ? { facets } : {}),
        ...(embed ? { embed } : {}),
      },
    };

    const resp = await fetch(`${BLUESKY_PDS_BASE}/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createRecordBody),
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'Bluesky access token invalid — user must reconnect'
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Bluesky rate-limited — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      // Bluesky returns ExpiredToken as HTTP 400 (NOT 401). With proactive
      // refreshCredentials() in the worker this should never fire, but if it
      // does (race between refresh + createRecord), classify as AUTH so the
      // worker marks the connection REVOKED + the user reconnects — instead of
      // misclassifying as NETWORK (retryable) which produced the "stuck
      // publishing" loop in the original logs.
      if (resp.status === 400 && text.includes('ExpiredToken')) {
        throw new PublishError(
          'AUTH',
          'Bluesky access token expired (refresh did not cover this request) — user must reconnect',
        );
      }
      throw new PublishError(
        'NETWORK',
        `Bluesky publish failed (${resp.status}): ${text}`,
      );
    }

    const data = (await resp.json()) as {
      uri: string; // at://did:plc:xxx/app.bsky.feed.post/yyy
      cid: string;
    };
    if (!data.uri) {
      throw new PublishError('NETWORK', 'Bluesky returned no post URI');
    }

    // Build the public URL from the at-uri
    // at://did:plc:xxx/app.bsky.feed.post/yyy → https://bsky.app/profile/handle/post/yyy
    const rkey = data.uri.split('/').pop();
    const url = `https://bsky.app/profile/${creds.handle}/post/${rkey}`;
    return {
      id: rkey ?? data.uri,
      url,
    };
  }

  /**
   * Read media bytes from a URL. For local /uploads/ files (the common case —
   * the upload controller stores relative URLs), reads directly from disk via
   * readLocalUploadFile (bypassing the ngrok/404 roundtrip). For external URLs
   * (e.g. an Unsplash image), HTTP-fetches the bytes.
   *
   * Returns the raw bytes + the MIME type (detected from the extension).
   */
  private async readMediaBytes(
    mediaUrl: string,
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    // Try local disk first — readLocalUploadFile handles both relative
    // (/uploads/x.jpg) and absolute (https://tunnel/uploads/x.jpg) URLs,
    // returning null for non-local URLs.
    const localBytes = readLocalUploadFile(mediaUrl);
    if (localBytes) {
      const ext = mediaUrl.split(/[?#]/)[0].match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? '';
      const mimeType = EXT_TO_MIME[ext];
      if (!mimeType) {
        throw new PublishError(
          'VALIDATION',
          `Bluesky media has an unsupported extension ("${ext}"). Supported: jpg, png, gif, webp, mp4.`,
        );
      }
      return { bytes: localBytes, mimeType };
    }

    // External URL — HTTP-fetch it. This is the fallback for non-/uploads/
    // URLs (e.g. cross-posted media from a CDN). The ngrok-skip header helps
    // with ngrok-free tunnels' "Visit Site" interstitial.
    const resp = await fetch(mediaUrl, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    });
    if (!resp.ok) {
      throw new PublishError(
        'NETWORK',
        `Could not fetch media for Bluesky upload (${resp.status}): ${mediaUrl}`,
      );
    }
    const bytes = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get('content-type') ?? '';
    const mimeType = contentType.split(';')[0].trim() || EXT_TO_MIME[mediaUrl.split(/[?#]/)[0].match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? ''] || '';
    if (!mimeType) {
      throw new PublishError(
        'VALIDATION',
        `Could not determine the media type for Bluesky upload: ${mediaUrl}`,
      );
    }
    return { bytes, mimeType };
  }

  /**
   * Upload an image as a Bluesky blob and return an `app.bsky.embed.images`
   * embed object ready for the post record.
   *
   * Flow (per AT Protocol spec + postflare's provider):
   *   1. Read the image bytes (local disk or HTTP).
   *   2. If the image exceeds 1 MB, resize it with sharp (Bluesky's hard
   *      limit is 1,000,000 bytes — larger blobs are rejected).
   *   3. POST the bytes to com.atproto.repo.uploadBlob with the correct
   *      Content-Type → get back a blob reference { $type, ref, mimeType, size }.
   *   4. Wrap the blob in an app.bsky.embed.images embed with the alt text.
   *
   * Bluesky accepts up to 4 images per post; this adapter attaches 1 (the
   * PostCard's single imageUrl). Multi-image carousel support is a follow-up.
   */
  private async uploadImageEmbed(
    mediaUrl: string,
    accessToken: string,
    altText: string,
  ): Promise<{ $type: string; images: unknown[] }> {
    let { bytes, mimeType } = await this.readMediaBytes(mediaUrl);

    if (!BLUESKY_IMAGE_MIMES.has(mimeType)) {
      throw new PublishError(
        'VALIDATION',
        `Bluesky does not accept "${mimeType}" images. Accepted: jpeg, png, webp, gif. ` +
          `If this is a video, it should be published as a video embed.`,
      );
    }

    // Resize if over the 1 MB limit. Iteratively compress: try JPEG quality
    // 85, 75, 65, 55 until under 950KB (leaves headroom under the 1MB hard
    // limit). sharp is a native dep — if not built (pnpm blocks build scripts),
    // surface a clear error.
    if (bytes.length > MAX_IMAGE_BYTES) {
      try {
        const sharp = (await import('sharp')).default;
        const qualities = [85, 75, 65, 55];
        for (const q of qualities) {
          const resized = await sharp(bytes)
            .resize({ width: 2000, withoutEnlargement: true })
            .jpeg({ quality: q })
            .toBuffer();
          if (resized.length <= 950_000) {
            bytes = resized;
            mimeType = 'image/jpeg';
            break;
          }
          // If this was the last quality attempt, use it anyway (best effort)
          if (q === qualities[qualities.length - 1]) {
            bytes = resized;
            mimeType = 'image/jpeg';
          }
        }
      } catch {
        throw new PublishError(
          'VALIDATION',
          `Image is ${(bytes.length / 1024 / 1024).toFixed(1)}MB; Bluesky requires ≤1MB. ` +
            `Resize the image (or install sharp: pnpm rebuild sharp) and try again.`,
        );
      }
    }

    // Upload the blob
    const uploadResp = await fetch(
      `${BLUESKY_PDS_BASE}/com.atproto.repo.uploadBlob`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': mimeType,
        },
        body: bytes,
      },
    );

    if (uploadResp.status === 401) {
      throw new PublishError('AUTH', 'Bluesky access token invalid during image upload');
    }
    if (!uploadResp.ok) {
      const errText = await uploadResp.text();
      throw new PublishError(
        'NETWORK',
        `Bluesky image upload failed (${uploadResp.status}): ${errText.slice(0, 300)}`,
      );
    }

    const uploadData = (await uploadResp.json()) as {
      blob?: { $type: string; ref: { $link: string }; mimeType: string; size: number };
    };
    if (!uploadData.blob) {
      throw new PublishError('NETWORK', 'Bluesky uploadBlob returned no blob reference');
    }

    return {
      $type: 'app.bsky.embed.images',
      images: [
        {
          alt: altText,
          image: uploadData.blob,
        },
      ],
    };
  }

  /**
   * Upload a video to Bluesky's video service and return an
   * `app.bsky.embed.video` embed object.
   *
   * Bluesky videos go through a SEPARATE service (video.bsky.app) that
   * transcodes the upload asynchronously. The video service does NOT accept
   * the PDS accessJwt — it requires a **service JWT** (a short-lived delegated
   * token scoped to the video service). Flow (per postflare + postiz + the
   * AT Protocol spec):
   *   0. Call com.atproto.server.getServiceAuth on the PDS with the accessJwt
   *      → get a service JWT scoped to did:web:{pds_host} +
   *      lxm=com.atproto.repo.uploadBlob, valid for 30 min.
   *   1. Read the video bytes (local disk or HTTP).
   *   2. POST to app.bsky.video.uploadVideo?did={did}&name={filename} with
   *      the SERVICE JWT (not accessJwt) → get a jobId.
   *   3. Poll app.bsky.video.getJobStatus?jobId={jobId} until
   *      state=JOB_STATE_COMPLETED → extract the blob ref.
   *   4. Wrap the blob in an app.bsky.embed.video embed.
   *
   * Constraints: video/mp4 only, ≤50MB. The adapter polls for up to 120s.
   */
  private async uploadVideoEmbed(
    mediaUrl: string,
    accessToken: string,
    did: string,
  ): Promise<{ $type: string; video: unknown }> {
    const { bytes, mimeType } = await this.readMediaBytes(mediaUrl);

    if (mimeType !== 'video/mp4') {
      throw new PublishError(
        'VALIDATION',
        `Bluesky only accepts video/mp4 for video embeds (got "${mimeType}"). ` +
          `Re-encode with: ffmpeg -i input -c:v libx264 -c:a aac output.mp4`,
      );
    }

    // Bluesky video limit is 50MB (per the app.bsky.video spec).
    if (bytes.length > 50 * 1024 * 1024) {
      throw new PublishError(
        'VALIDATION',
        `Video is ${(bytes.length / 1024 / 1024).toFixed(1)}MB; Bluesky's limit is 50MB. ` +
          `Compress with: ffmpeg -i input -c:v libx264 -crf 28 -c:a aac output.mp4`,
      );
    }

    // Step 0: get a service JWT scoped to the video service.
    // The PDS accessJwt is scoped to the user's PDS; the video service
    // (video.bsky.app) rejects it with 401. getServiceAuth mints a
    // short-lived (30 min) delegated token that the video service accepts.
    // getServiceJwt decodes the accessJwt to find the user's PDS DID + URL,
    // then calls getServiceAuth ON THE USER'S PDS (not bsky.social — users
    // may be on a different PDS like fibercap.us-west.host.bsky.network).
    const serviceJwt = await this.getServiceJwt(accessToken);

    // Extract a safe filename for the upload's `name` query param.
    const filename = mediaUrl.split(/[?#]/)[0].split('/').pop() || 'video.mp4';

    // Step 1: upload to the video service using the SERVICE JWT.
    // The upload URL requires `did` + `name` query params (per postflare).
    const uploadUrl = new URL(`${BLUESKY_VIDEO_BASE}/app.bsky.video.uploadVideo`);
    uploadUrl.searchParams.set('did', did);
    uploadUrl.searchParams.set('name', filename);

    const uploadResp = await fetch(uploadUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceJwt}`,
        'Content-Type': 'video/mp4',
      },
      body: bytes,
    });

    if (uploadResp.status === 401) {
      // The video service rejected the upload. The accessJwt itself is VALID
      // (getServiceAuth succeeded with it) — so this is NOT a connection
      // problem. Classify as NETWORK (retryable) by default, NOT AUTH —
      // classifying as AUTH would mark the Bluesky connection REVOKED,
      // preventing text/image posts too (which would work fine).
      //
      // BUT: some 401 errors are PERMANENT account-level restrictions (not
      // retryable). Parse the response body to detect known errors:
      //   - "unconfirmed_email": the user's Bluesky account has an email that
      //     hasn't been confirmed. The video service requires a confirmed email
      //     (anti-abuse). Retrying won't help — classify as VALIDATION so the
      //     worker doesn't retry 3× and the user gets a clear, actionable
      //     message telling them to confirm their email on bsky.app.
      const errBody = await uploadResp.text().catch(() => '<no body>');
      let errError = '';
      try {
        const parsed = JSON.parse(errBody) as { jobStatus?: { error?: string }; error?: string };
        errError = parsed.jobStatus?.error ?? parsed.error ?? '';
      } catch {
        // not JSON — errError stays empty, falls through to the generic message
      }

      if (errError === 'unconfirmed_email') {
        throw new PublishError(
          'VALIDATION',
          'Bluesky requires a CONFIRMED email address to upload videos. ' +
            'Go to bsky.app → Settings → Email → click the confirmation link ' +
            'in the verification email Bluesky sent you. Then retry the ' +
            'publish. (Your Bluesky connection is fine — text and image posts ' +
            'work without a confirmed email; only video uploads require it.)',
        );
      }

      // Generic 401 — retryable (may be a transient token issue)
      throw new PublishError(
        'NETWORK',
        `Bluesky video service rejected the upload (401). The accessJwt is valid ` +
          `(getServiceAuth succeeded) — the connection is NOT revoked. ` +
          `The video service may be transiently unavailable or the video may ` +
          `need re-encoding (H.264 mp4, ≤50MB). Response: ${errBody.slice(0, 200)}`,
      );
    }

    // Parse the upload response. For a 200, the body has { jobId, blob? }.
    // For a 409, the video was ALREADY uploaded in a previous attempt — the
    // body has { jobId, state: "JOB_STATE_COMPLETED", error: "already_exists" }.
    // The 409 is NOT an error: the video is processed + ready. Extract the
    // jobId and proceed to polling (getJobStatus returns the completed blob
    // immediately). This matches postflare's 409 handling (catch → extract
    // jobId → return it for polling).
    let uploadData: {
      jobId?: string;
      blob?: { $type: string; ref: { $link: string }; mimeType: string; size: number };
    };

    if (uploadResp.status === 409) {
      const body409 = (await uploadResp.json().catch(() => ({}))) as {
        jobId?: string;
        state?: string;
        error?: string;
        message?: string;
      };
      if (body409.jobId) {
        // The video was already processed — use the existing jobId for polling.
        // getJobStatus will return JOB_STATE_COMPLETED + the blob immediately.
        uploadData = { jobId: body409.jobId };
      } else {
        throw new PublishError(
          'NETWORK',
          `Bluesky video service returned 409 (already_exists) but no jobId — ` +
            `cannot retrieve the processed video. Response: ${JSON.stringify(body409).slice(0, 200)}`,
        );
      }
    } else if (!uploadResp.ok) {
      const errText = await uploadResp.text();
      throw new PublishError(
        'NETWORK',
        `Bluesky video upload failed (${uploadResp.status}): ${errText.slice(0, 300)}`,
      );
    } else {
      uploadData = (await uploadResp.json()) as typeof uploadData;
    }

    // Small videos may return the blob immediately (no polling needed).
    if (uploadData.blob) {
      return {
        $type: 'app.bsky.embed.video',
        video: uploadData.blob,
      };
    }

    if (!uploadData.jobId) {
      throw new PublishError(
        'NETWORK',
        'Bluesky video service returned no jobId and no blob — upload may have failed',
      );
    }

    // Step 2: poll for processing completion (up to 120s, every 3s)
    const POLL_TIMEOUT_MS = 120_000;
    const POLL_INTERVAL_MS = 3_000;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let videoBlob: unknown;

    while (Date.now() < deadline) {
      const statusUrl = new URL(`${BLUESKY_VIDEO_BASE}/app.bsky.video.getJobStatus`);
      statusUrl.searchParams.set('jobId', uploadData.jobId);

      const statusResp = await fetch(statusUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!statusResp.ok) {
        // Transient status-fetch failure — wait + retry
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      const statusData = (await statusResp.json()) as {
        jobStatus?: {
          state: string;
          blob?: { $type: string; ref: { $link: string }; mimeType: string; size: number };
          error?: string;
          message?: string;
        };
      };

      const state = statusData.jobStatus?.state;
      if (state === 'JOB_STATE_COMPLETED' && statusData.jobStatus?.blob) {
        videoBlob = statusData.jobStatus.blob;
        break;
      }
      if (state === 'JOB_STATE_FAILED') {
        throw new PublishError(
          'VALIDATION',
          `Bluesky could not process the video: ${statusData.jobStatus?.error ?? statusData.jobStatus?.message ?? 'unknown error'}. ` +
            `Ensure it's H.264 mp4, ≤50MB, ≤60s.`,
        );
      }
      // JOB_STATE_IN_PROGRESS / JOB_STATE_CREATED — keep polling
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!videoBlob) {
      throw new PublishError(
        'NETWORK',
        `Bluesky video processing timed out after ${POLL_TIMEOUT_MS / 1000}s (jobId: ${uploadData.jobId}). ` +
          `The video may still publish asynchronously — check bsky.app for the post.`,
      );
    }

    return {
      $type: 'app.bsky.embed.video',
      video: videoBlob,
    };
  }

  /**
   * Get a Bluesky service JWT for the video upload service.
   *
   * The video service (video.bsky.app) does NOT accept the PDS accessJwt — it
   * requires a service JWT minted via `com.atproto.server.getServiceAuth`.
   *
   * CRITICAL: the `aud` (audience) for the service JWT must be the USER'S PDS
   * DID — NOT the video service's DID. The video service uses `aud` to
   * identify which PDS minted the token. If `aud` is wrong, the video service
   * returns: "invalid token audience '...', should be the user's PDS DID '...'".
   *
   * The user's PDS is NOT always bsky.social — Bluesky hosts users across
   * multiple PDS instances (fibercap.us-west.host.bsky.network, etc.). The
   * access JWT's `aud` claim IS the PDS DID, so we decode it to find the
   * user's PDS, resolve its URL, and call getServiceAuth ON THE USER'S PDS
   * (not bsky.social — a different PDS can't mint tokens for the video
   * service that the video service will accept).
   *
   * Flow (matching postflare's implementation):
   *   1. Decode the accessJwt → extract the `aud` claim (the PDS DID).
   *   2. Resolve the PDS DID → PDS HTTPS URL (did:web → direct, did:plc → PLC directory).
   *   3. Call getServiceAuth on the USER'S PDS with aud=PDS DID, lxm=com.atproto.repo.uploadBlob.
   *   4. Return the service JWT.
   */
  private async getServiceJwt(accessToken: string): Promise<string> {
    // Step 1: decode the PDS DID from the accessJwt's `aud` claim.
    const pdsDid = decodeJwtAud(accessToken);
    if (!pdsDid) {
      throw new PublishError(
        'NETWORK',
        'Could not extract the PDS DID from the Bluesky access token — ' +
          'the JWT payload has no `aud` claim. The user may need to reconnect.',
      );
    }

    // Step 2: resolve the PDS DID → PDS HTTPS URL.
    const pdsUrl = await resolvePdsUrl(pdsDid);
    if (!pdsUrl) {
      throw new PublishError(
        'NETWORK',
        `Could not resolve the PDS URL from DID "${pdsDid}". ` +
          `The user's PDS may be unreachable or the DID format is unsupported.`,
      );
    }

    // Step 3: call getServiceAuth on the USER'S PDS (not bsky.social).
    // aud = the user's PDS DID (the video service uses this to identify the
    // minting PDS). lxm = com.atproto.repo.uploadBlob (the authorized method).
    const authUrl = new URL(`${pdsUrl}/xrpc/com.atproto.server.getServiceAuth`);
    authUrl.searchParams.set('aud', pdsDid);
    authUrl.searchParams.set('lxm', 'com.atproto.repo.uploadBlob');
    authUrl.searchParams.set('exp', String(Math.floor(Date.now() / 1000) + 1800));

    const resp = await fetch(authUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'Bluesky access token expired — could not mint service JWT for video upload',
      );
    }
    if (!resp.ok) {
      const errText = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Bluesky getServiceAuth failed (${resp.status}) on PDS ${pdsUrl}: ${errText.slice(0, 300)}`,
      );
    }

    const data = (await resp.json()) as { token?: string };
    if (!data.token) {
      throw new PublishError(
        'NETWORK',
        `Bluesky getServiceAuth on PDS ${pdsUrl} returned no token`,
      );
    }
    return data.token;
  }
}

/**
 * Count graphemes in a string. Uses Intl.Segmenter when available (Node 16+).
 * Falls back to a simple code-point count if not.
 */
function countGraphemes(s: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    type SegmenterCtor = new (
      locale: string,
      opts: { granularity: 'grapheme' }
    ) => { segment: (s: string) => Iterable<unknown> };
    const Ctor = (Intl as unknown as { Segmenter: SegmenterCtor }).Segmenter;
    const segmenter = new Ctor('en', { granularity: 'grapheme' });
    let count = 0;
    for (const _ of segmenter.segment(s)) {
      count++;
    }
    return count;
  }
  // Fallback: code-point count (slightly under-counts emoji + combined)
  return [...s].length;
}

/**
 * Convert a UTF-16 offset to a UTF-8 byte offset (Bluesky uses UTF-8).
 */
function utf16ToUtf8ByteOffset(s: string, utf16Offset: number): number {
  const sub = s.slice(0, utf16Offset);
  return Buffer.from(sub, 'utf8').length;
}
