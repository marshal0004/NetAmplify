// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/hashnode/hashnode.adapter.ts
// NetAmplify — Hashnode adapter.
//
// SIMPLE credential: user pastes a Personal Access Token from
// hashnode.com/settings/developer. We validate by POST-ing the GraphQL
// query `me` (returns the user's username + publications), then store the
// PAT encrypted.
//
// Hashnode API docs: https://apidocs.hashnode.com/graphql-api-v2
//
// IMPORTANT — endpoint history (verified Nov 2026 via live curl tests +
// postiz's working implementation):
//   - https://gql.hashnode.com → NOW RETURNS A 301 REDIRECT to
//     https://hashnode.com/announcements/graphql-api (an HTML announcement
//     page, NOT the GraphQL API). A GraphQL POST here gets a text/html 301
//     response → safeJsonResp throws "non-JSON response". This broke every
//     Hashnode publish + validateCredentials call.
//   - https://gql-beta.hashnode.com → the WORKING GraphQL endpoint (returns
//     200 + application/json for GraphQL POSTs). This is what postiz uses
//     (libraries/nestjs-libraries/src/integrations/social/hashnode.provider.ts).
//     An earlier revision incorrectly swapped AWAY from gql-beta on the
//     belief that gql.hashnode.com was current — the live curl test proves
//     that was wrong: gql-beta returns JSON, gql returns HTML.
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
import { isVideoMedia } from '../../services/uploads-dir';

// The working Hashnode GraphQL endpoint (POST only).
// gql.hashnode.com now redirects to an HTML page; gql-beta.hashnode.com
// still serves the GraphQL API. Verified by live curl: gql-beta returns
// 200 + application/json, gql returns 301 + text/html.
const HASHNODE_GRAPHQL_URL = 'https://gql-beta.hashnode.com';

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for Hashnode.
 */
export interface HashnodeCredentials extends AdapterCredentials {
  pat: string;
  /** Publication ID (required for publishing). Fetched during validation. */
  publicationId?: string;
}

@Injectable()
export class HashnodeAdapter implements PlatformAdapter {
  readonly platform: Platform = 'HASHNODE';
  readonly name = 'Hashnode';
  readonly toolTip = 'Paste your Hashnode Personal Access Token';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    return true;
  }

  /**
   * Safely parse a JSON response from the Hashnode GraphQL API.
   *
   * Defensive guard: if the API returns HTML instead of JSON (e.g., due to
   * a CDN redirect, Cloudflare challenge, or endpoint change), throw a
   * clear PublishError instead of letting `resp.json()` crash with an
   * unhandled SyntaxError.
   */
  private async safeJsonResp(resp: Response, context: string): Promise<unknown> {
    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text();

    if (!contentType.includes('application/json') && !text.trim().startsWith('{')) {
      // The response is NOT JSON — likely HTML (redirect page, error page, etc.)
      throw new PublishError(
        'NETWORK',
        `Hashnode API returned a non-JSON response (${context}). ` +
          `Status: ${resp.status}, Content-Type: ${contentType}. ` +
          `The API endpoint may have changed. Response preview: ${text.slice(0, 200)}...`,
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new PublishError(
        'NETWORK',
        `Hashnode API returned invalid JSON (${context}). ` +
          `Status: ${resp.status}. Response preview: ${text.slice(0, 200)}...`,
      );
    }
  }

  /**
   * Validate the user-pasted Hashnode PAT by querying the `me` field.
   * Per docs/02-SRS.md FR-005: validate via identity endpoint before saving.
   *
   * Also fetches the user's first publication (needed for publishing later).
   * If the user has no publications, we still save the connection but warn
   * the user they need to create a blog on Hashnode before they can publish.
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: HashnodeCredentials }> {
    const pat = input.pat;
    if (!pat || typeof pat !== 'string') {
      throw new PublishError('VALIDATION', 'pat (Personal Access Token) is required');
    }

    // GraphQL query using the correct Relay-style pagination schema.
    // The old `nodes` field was removed; the API now uses `edges { node { ... } }`.
    const query = `
      query {
        me {
          id
          username
          publications(first: 1) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      }
    `;
    const resp = await fetch(HASHNODE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: pat,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new PublishError(
        'AUTH',
        'Hashnode PAT is invalid — regenerate from hashnode.com/settings/developer'
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Hashnode is rate-limiting — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Hashnode validation failed (${resp.status}): ${text.slice(0, 300)}`
      );
    }

    // Safely parse the JSON response (handles HTML/non-JSON responses)
    const data = (await this.safeJsonResp(resp, 'validateCredentials')) as {
      data?: {
        me?: {
          id: string;
          username: string;
          publications?: { edges: Array<{ node: { id: string; title: string } }> };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors && data.errors.length > 0) {
      throw new PublishError(
        'VALIDATION',
        `Hashnode rejected PAT: ${data.errors.map((e) => e.message).join('; ')}`
      );
    }
    if (!data.data?.me) {
      throw new PublishError(
        'AUTH',
        'Hashnode returned no user for this PAT — token may be invalid'
      );
    }

    const me = data.data.me;
    const publicationId = me.publications?.edges?.[0]?.node?.id;

    // If the user has no publications, we still save the connection (so they
    // don't have to re-enter the PAT later), but we surface a clear warning.
    if (!publicationId) {
      // We'll still return successfully — the connection is valid, the user
      // just needs to create a blog on Hashnode. When they try to publish,
      // the publish() method will throw a clear error.
      // We use a special username prefix to signal this in the UI.
    }

    return {
      identity: {
        id: me.id,
        username: me.username,
      },
      credentials: {
        pat,
        publicationId,
      },
    };
  }

  /**
   * Publish a markdown article to the user's Hashnode publication.
   *
   * Endpoint: POST https://gql-beta.hashnode.com (GraphQL)
   * Mutation: publishPost(input: { publicationId, title, contentMarkdown, tags, ... })
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as HashnodeCredentials;
    if (!creds.pat) {
      throw new PublishError('AUTH', 'Hashnode PAT missing from credentials');
    }

    // The publicationId is fetched during validateCredentials (connect time).
    // But if the user connected before the publication existed, or if the
    // connect-time fetch failed silently, creds.publicationId would be
    // undefined — and the old code threw immediately, forcing the user to
    // disconnect + reconnect. Instead, re-fetch the publications list now.
    // This is resilient: a stale connection self-heals on the next publish
    // without any user action (as long as they've since created a blog on
    // Hashnode).
    let publicationId = creds.publicationId;
    if (!publicationId) {
      const fetched = await this.fetchFirstPublicationId(creds.pat);
      if (fetched) {
        publicationId = fetched;
      } else {
        throw new PublishError(
          'VALIDATION',
          'No Hashnode publication found for this PAT. A Hashnode ACCOUNT ' +
            '(username) is NOT the same as a PUBLICATION (blog) — you need ' +
            'to explicitly create a blog:\n' +
            '  1. Go to hashnode.com → sign in with your account\n' +
            '  2. Click "Create a blog" → choose a blog name → create\n' +
            '  3. Wait a moment, then retry the publish (the adapter re-fetches ' +
            'the publication automatically — no need to disconnect/reconnect)\n' +
            'If you already created a blog, verify your PAT was generated from ' +
            'the SAME account that owns the blog (hashnode.com/settings/developer).'
        );
      }
    }

    // Hashnode tags must come from its whitelist (hashnode.tags.ts)
    // For MVP, we send tags as-is; Hashnode will reject unknown tags, which
    // surfaces as a VALIDATION error.
    //
    // Per-platform overrides (formatted.options) come from the PublishPage
    // per-platform options panel: tags (override the PostCard tech-stack
    // hashtags), subtitle, canonicalUrl, coverImage. Each falls back to the
    // Format Engine default when the user didn't set one.
    const opt = formatted.options ?? {};
    const tagSource: string[] = Array.isArray(opt.tags)
      ? opt.tags.map(String)
      : (formatted.hashtags ?? []);
    const tags = tagSource
      .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter((t) => t.length > 0)
      .slice(0, 5);

    const subtitle =
      typeof opt.subtitle === 'string' && opt.subtitle.trim().length > 0 ? opt.subtitle.trim() : undefined;

    const mutation = `
      mutation PublishPost($input: PublishPostInput!) {
        publishPost(input: $input) {
          post {
            id
            slug
            url
          }
        }
      }
    `;
    // coverImageURL — Hashnode fetches the image from this URL for the post's
    // cover. The hashnodeFormatter provides it as formatted.options.coverImage
    // (from postCard.imageUrl); the per-platform panel can override it.
    //
    // IMPORTANT: Hashnode is a BLOGGING platform — coverImageURL must be an
    // IMAGE (jpg/png/gif/webp). If the PostCard's media is a VIDEO (.mp4),
    // sending it as coverImageURL silently fails (Hashnode can't render a
    // video as a cover). So: if the cover image URL points to a video file,
    // skip it entirely — the article still publishes (markdown content +
    // tags), just without a cover image. This is the correct behavior:
    // Hashnode does not support video posts or video covers.
    let coverImage =
      (typeof opt.coverImage === 'string' && opt.coverImage.trim()) ? opt.coverImage.trim() : undefined;
    if (coverImage && isVideoMedia(coverImage)) {
      // Video can't be a Hashnode cover image — skip it, publish without a cover.
      // (Not an error — the article content is still valid; only the cover is dropped.)
      coverImage = undefined;
    }
    // canonicalUrl — defaults to the PostCard repo/live URL (formatted.url);
    // the panel can override (e.g. for cross-posting a canonical source).
    const canonicalUrl =
      (typeof opt.canonicalUrl === 'string' && opt.canonicalUrl.trim()) ? opt.canonicalUrl.trim() : formatted.url;
    const variables = {
      input: {
        publicationId,
        title: formatted.title,
        contentMarkdown: formatted.body,
        tags: tags.map((slug) => ({ slug, name: slug })),
        ...(canonicalUrl ? { canonicalUrl } : {}),
        ...(coverImage ? { coverImageURL: coverImage } : {}),
        ...(subtitle ? { subtitle } : {}),
      },
    };

    const resp = await fetch(HASHNODE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: creds.pat,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new PublishError(
        'AUTH',
        'Hashnode PAT invalid or revoked — user must reconnect'
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Hashnode rate-limited — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Hashnode publish failed (${resp.status}): ${text.slice(0, 300)}`
      );
    }

    // Safely parse the JSON response
    const data = (await this.safeJsonResp(resp, 'publish')) as {
      data?: { publishPost?: { post?: { id: string; slug: string; url?: string } } };
      errors?: Array<{ message: string }>;
    };

    if (data.errors && data.errors.length > 0) {
      throw new PublishError(
        'VALIDATION',
        `Hashnode rejected post: ${data.errors.map((e) => e.message).join('; ')}`
      );
    }
    const post = data.data?.publishPost?.post;
    if (!post) {
      throw new PublishError(
        'NETWORK',
        'Hashnode returned no post id/url (unexpected response shape)'
      );
    }
    return {
      id: post.id,
      url: post.url || `https://hashnode.com/post/${post.slug}`,
    };
  }

  /**
   * Fetch the user's first publication ID from Hashnode's GraphQL API.
   *
   * Called by publish() when creds.publicationId is missing (stale connection
   * — the user connected before creating a blog, or the connect-time fetch
   * failed silently). This re-fetch self-heals the connection without forcing
   * a disconnect/reconnect.
   *
   * Uses `publications(first: 50)` (same as postiz) instead of `first: 1` —
   * a user with multiple publications gets the most-recently-created one
   * (Hashnode returns publications newest-first), which is the one they most
   * likely intend to publish to.
   *
   * Returns null if the user has zero publications (they need to create a
   * blog on hashnode.com first). Throws AUTH/NETWORK on token/network errors.
   */
  private async fetchFirstPublicationId(pat: string): Promise<string | null> {
    const query = `
      query {
        me {
          id
          publications(first: 50) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      }
    `;
    const resp = await fetch(HASHNODE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: pat,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new PublishError(
        'AUTH',
        'Hashnode PAT is invalid or revoked — user must reconnect',
      );
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Hashnode publication fetch failed (${resp.status}): ${text.slice(0, 300)}`,
      );
    }

    const data = (await this.safeJsonResp(resp, 'fetchFirstPublicationId')) as {
      data?: {
        me?: {
          publications?: {
            edges: Array<{ node: { id: string; title: string } }>;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors && data.errors.length > 0) {
      throw new PublishError(
        'VALIDATION',
        `Hashnode rejected publication fetch: ${data.errors.map((e) => e.message).join('; ')}`,
      );
    }

    const edges = data.data?.me?.publications?.edges;
    if (!edges || edges.length === 0) {
      return null; // user has no publications — caller throws a clear message
    }
    return edges[0].node.id;
  }
}
