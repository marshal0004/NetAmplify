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

const BLUESKY_PDS_BASE = 'https://bsky.social/xrpc';
const BLUESKY_PUBLIC_BASE = 'https://public.api.bsky.app/xrpc';

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

    // Build post text: title + body + tags (all concatenated, ≤300 graphemes)
    const tags = formatted.hashtags ?? [];
    const tagsLine = tags.length > 0 ? `\n\n${tags.map((t) => `#${t}`).join(' ')}` : '';
    const urlLine = formatted.url ? `\n${formatted.url}` : '';
    const text = `${formatted.title}\n\n${formatted.body}${urlLine}${tagsLine}`;

    // Grapheme count check (Bluesky uses graphemes, not UTF-16 code units)
    const graphemeCount = countGraphemes(text);
    if (graphemeCount > 300) {
      throw new PublishError(
        'VALIDATION',
        `Bluesky post exceeds 300 graphemes (got ${graphemeCount})`
      );
    }

    // Build facets for the URL (so Bluesky renders it as a clickable link)
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

    // Create the record
    const createRecordBody = {
      repo: creds.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
        ...(facets.length > 0 ? { facets } : {}),
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
      throw new PublishError(
        'NETWORK',
        `Bluesky publish failed (${resp.status}): ${text}`
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
