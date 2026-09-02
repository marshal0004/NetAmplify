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
    const tags = (formatted.hashtags ?? [])
      .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter((t) => t.length > 0)
      .slice(0, 4); // Dev.to limit: 4 tags

    const payload: DevtoArticlePayload = {
      article: {
        title: formatted.title,
        body_markdown: formatted.body,
        tags,
        published: true, // MVP: publish immediately (no draft state)
        ...(formatted.options?.imageUrl
          ? { main_image: formatted.options.imageUrl as string }
          : {}),
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
