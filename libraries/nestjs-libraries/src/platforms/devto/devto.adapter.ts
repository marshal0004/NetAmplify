// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/devto/devto.adapter.ts
// NetAmplify — Dev.to adapter.
//
// SIMPLE credential: user pastes an API key from
// dev.to/settings/extensions. We validate by GET-ing /api/users/me (returns
// the user's username), then store the key encrypted.
//
// Dev.to API docs: https://developers.forem.com/api/v1#tag/articles
//
// Trust model per docs/12-TRUST-COPY.md §1:
//   "You generate this key yourself in your account's settings. It can
//    only manage content — and you can regenerate or delete it whenever
//    you want."

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
import { resolvePublicMediaUrl, isVideoMedia, ensurePublicMediaUrl } from '../../services/uploads-dir';

const DEVTO_API_BASE = 'https://dev.to/api';

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for Dev.to.
 */
export interface DevtoCredentials extends AdapterCredentials {
  apiKey: string;
}

/**
 * Dev.to article payload — sent to POST /api/articles.
 * Docs: https://developers.forem.com/api/v1#tag/articles/operation/createArticle
 */
interface DevtoArticlePayload {
  article: {
    title: string;
    body_markdown: string;
    tags?: string[];
    published?: boolean;
    main_image?: string;
    canonical_url?: string;
  };
}

@Injectable()
export class DevtoAdapter implements PlatformAdapter {
  readonly platform: Platform = 'DEVTO';
  readonly name = 'Dev.to';
  readonly toolTip = 'Paste your Dev.to API key';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    // Dev.to requires no env vars — the user pastes their own API key.
    return true;
  }

  /**
   * Validate the user-pasted Dev.to API key by GET-ing /api/users/me.
   * Per docs/02-SRS.md FR-005: "server validates by calling the platform's
   * identity endpoint (api-key must resolve to a username) BEFORE saving."
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: DevtoCredentials }> {
    const apiKey = input.apiKey;
    if (!apiKey || typeof apiKey !== 'string') {
      throw new PublishError('VALIDATION', 'apiKey is required');
    }

    const resp = await fetch(`${DEVTO_API_BASE}/users/me`, {
      method: 'GET',
      headers: { 'api-key': apiKey },
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'Dev.to API key is invalid — regenerate from dev.to/settings/extensions'
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Dev.to is rate-limiting — try again in a moment');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Dev.to validation failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as { id: number; username: string };
    return {
      identity: {
        id: String(data.id),
        username: data.username,
      },
      credentials: { apiKey },
    };
  }

  /**
   * Publish a markdown article to Dev.to. Per FR-011, the Format Engine
   * produces markdown content; we wrap it in the Dev.to article payload.
   *
   * Endpoint: POST /api/articles
   * Docs: https://developers.forem.com/api/v1#tag/articles/operation/createArticle
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as DevtoCredentials;
    if (!creds.apiKey) {
      throw new PublishError('AUTH', 'Dev.to API key missing from credentials');
    }

    // Strip Dev.to's reserved tag prefixes (per Dev.to API docs: tags must
    // be 1-3 lowercase alphanumeric words, no '#')
    //
    // Per-platform overrides (formatted.options) come from the PublishPage
    // per-platform options panel: tags (override the PostCard tech-stack
    // hashtags), published (draft vs. publish), canonicalUrl. Each falls back
    // to the Format Engine default when the user didn't set one.
    const opt = formatted.options ?? {};
    const tagSource: string[] = Array.isArray(opt.tags)
      ? opt.tags.map(String)
      : (formatted.hashtags ?? []);
    const tags = tagSource
      .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter((t) => t.length > 0)
      .slice(0, 4); // Dev.to limit: 4 tags
    const published = typeof opt.published === 'boolean' ? opt.published : true;
    // Validate canonical URL — Dev.to rejects invalid URLs with 422.
    // Only send if it's a valid http/https URL.
    let canonicalUrl: string | undefined;
    const rawCanonical = typeof opt.canonicalUrl === 'string' ? opt.canonicalUrl.trim() : '';
    if (rawCanonical) {
      try {
        const parsed = new URL(rawCanonical);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          canonicalUrl = rawCanonical;
        }
      } catch {
        // Invalid URL — omit it (Dev.to would reject with 422)
      }
    }

    // Resolve the media URL.
    //
    // - IMAGE: sent as `main_image` (Dev.to's cover image field). Dev.to
    //   fetches it server-side, so it MUST be a public HTTPS URL. Relative /
    //   localhost URLs are skipped (article publishes without a cover).
    //
    // - VIDEO: Dev.to does NOT accept videos as `main_image`/`cover_image`
    //   (422 "Main image is not a valid URL"). But Forem's body_markdown
    //   sanitizer DOES allow the <video> + <source> HTML tags (confirmed in
    //   forem/forem app/services/markdown_processor.rb →
    //   AllowedTags::RENDERED_MARKDOWN_SCRUBBER, which includes `video` and
    //   `source` with attributes src/controls/preload/poster/width/height).
    //   So a video is embedded inline in the body as a playable <video>
    //   element, using a public URL resolved via ensurePublicMediaUrl
    //   (catbox.moe fallback when the local /uploads/ file isn't publicly
    //   reachable — no ngrok/cloudflared needed).
    let mainImage: string | undefined;
    let videoEmbed: string | undefined;
    if (formatted.options?.imageUrl) {
      const rawUrl = formatted.options.imageUrl as string;
      if (isVideoMedia(rawUrl)) {
        // Resolve a public URL for the video, then embed it inline.
        // ensurePublicMediaUrl uploads local files to catbox.moe when the
        // URL isn't publicly reachable, so Dev.to can always fetch it.
        const publicVideoUrl = await ensurePublicMediaUrl(rawUrl);
        videoEmbed = `\n\n<video controls preload="metadata" src="${publicVideoUrl}"></video>\n`;
      } else {
        const resolved = resolvePublicMediaUrl(rawUrl);
        if (resolved) {
          // Skip localhost URLs — Dev.to's servers can't fetch from localhost.
          // Also skip http:// (Dev.to requires HTTPS for image URLs).
          if (
            !resolved.includes('localhost') &&
            !resolved.includes('127.0.0.1') &&
            resolved.startsWith('https://')
          ) {
            mainImage = resolved;
          }
          // If the URL is localhost or http://, silently skip — the article
          // publishes without a cover image (better than failing the whole post).
        }
        // If resolvePublicMediaUrl returns null (PUBLIC_APP_URL not set),
        // skip main_image — don't throw (the article can still publish text-only).
      }
    }

    // Sanitize the body_markdown's cover_image frontmatter line.
    // The formatter writes `cover_image: ${postCard.imageUrl}` (a RELATIVE URL
    // like /uploads/abc.jpg). Dev.to parses the body frontmatter and tries to
    // fetch that URL as the cover — if it's not a public HTTPS URL, Dev.to
    // returns 422 "Main image is not a valid URL" (even if the main_image API
    // field is omitted). Sync the body's cover_image with the resolved
    // mainImage (a public URL), or remove the line entirely if the URL isn't
    // publicly reachable, so Dev.to never sees an invalid cover URL.
    //
    // For videos, there is NO mainImage (Dev.to rejects video covers) — the
    // cover_image frontmatter line is always removed, and the video is
    // embedded inline in the body instead (see videoEmbed above).
    let body = formatted.body;
    if (/^cover_image:.*$/m.test(body)) {
      if (mainImage) {
        body = body.replace(/^(cover_image:).*$/m, `$1 ${mainImage}`);
      } else {
        body = body.replace(/^cover_image:.*\n?/m, '');
      }
    }
    // Append the video embed to the body (after the frontmatter/cover block).
    if (videoEmbed) {
      body = body + videoEmbed;
    }

    const payload: DevtoArticlePayload = {
      article: {
        title: formatted.title,
        body_markdown: body,
        tags,
        published, // MVP default: publish immediately (panel can set draft=false)
        ...(mainImage ? { main_image: mainImage } : {}),
        ...(canonicalUrl ? { canonical_url: canonicalUrl } : {}),
      },
    };

    const resp = await fetch(`${DEVTO_API_BASE}/articles`, {
      method: 'POST',
      headers: {
        'api-key': creds.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'Dev.to API key is invalid or revoked — user must reconnect'
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Dev.to is rate-limiting — try again later');
    }
    if (resp.status === 422) {
      const text = await resp.text();
      // Dev.to's servers fetch the main_image URL. If they can't (ngrok-free
      // "Visit Site" interstitial, 404, private network, non-image response),
      // Dev.to returns 422 "Main image is not a valid URL". Rather than fail
      // the whole article, retry WITHOUT main_image — the article publishes
      // text-only (no cover), which is better than a failed post.
      if (mainImage && /Main image is not a valid URL/i.test(text)) {
        const { main_image: _drop, ...articleWithoutImage } = payload.article;
        const retryResp = await fetch(`${DEVTO_API_BASE}/articles`, {
          method: 'POST',
          headers: {
            'api-key': creds.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ article: articleWithoutImage }),
        });
        if (retryResp.ok) {
          const retryData = (await retryResp.json()) as {
            id: number; url: string; slug?: string; path?: string;
          };
          return {
            id: String(retryData.id),
            url: retryData.url ||
              `https://dev.to${retryData.path || `/${retryData.slug}`}`,
          };
        }
        const retryText = await retryResp.text();
        throw new PublishError(
          'VALIDATION',
          `Dev.to rejected article (text-only retry after image fetch failed): ${retryText}`
        );
      }
      throw new PublishError('VALIDATION', `Dev.to rejected article: ${text}`);
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Dev.to publish failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as {
      id: number;
      url: string;
      slug?: string;
      path?: string;
    };

    if (!data.url && !data.path) {
      throw new PublishError('NETWORK', 'Dev.to returned no article URL');
    }
    return {
      id: String(data.id),
      url: data.url || `https://dev.to${data.path || `/${data.slug}`}`,
    };
  }
}
