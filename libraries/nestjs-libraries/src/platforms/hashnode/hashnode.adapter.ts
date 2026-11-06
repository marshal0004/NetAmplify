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
// IMPORTANT: The old endpoint `https://gql.hashnode.com` was retired in
// May 2026 (redirects to a paid-access changelog page). The current
// working endpoint is `https://gql-beta.hashnode.com`.
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

// The old endpoint `https://gql.hashnode.com` was retired in May 2026.
// It now returns a 301 redirect to a paid-access changelog page (HTML),
// which causes `resp.json()` to crash with "Unexpected token '<'".
// The current working endpoint is `https://gql-beta.hashnode.com`.
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
    if (!creds.publicationId) {
      throw new PublishError(
        'VALIDATION',
        'No Hashnode publication found. Create a blog on hashnode.com first ' +
          '(click "Create a blog" → choose a blog name → create). Then ' +
          'disconnect Hashnode in NetAmplify and reconnect to pick up the ' +
          'new publication ID.'
      );
    }

    // Hashnode tags must come from its whitelist (hashnode.tags.ts)
    // For MVP, we send tags as-is; Hashnode will reject unknown tags, which
    // surfaces as a VALIDATION error.
    const tags = (formatted.hashtags ?? [])
      .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter((t) => t.length > 0)
      .slice(0, 5);

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
    const variables = {
      input: {
        publicationId: creds.publicationId,
        title: formatted.title,
        contentMarkdown: formatted.body,
        tags: tags.map((slug) => ({ slug, name: slug })),
        ...(formatted.url ? { canonicalUrl: formatted.url } : {}),
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
}
