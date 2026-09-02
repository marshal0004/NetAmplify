// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/hashnode/hashnode.adapter.ts
// NetAmplify — Hashnode adapter.
//
// SIMPLE credential: user pastes a Personal Access Token from
// hashnode.com/settings/developer. We validate by POST-ing the GraphQL
// query `me` (returns the user's username), then store the PAT encrypted.
//
// Hashnode API docs: https://apidocs.hashnode.com/graphql-api-v2
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

const HASHNODE_GRAPHQL_URL = 'https://gql.hashnode.com';

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
   * Validate the user-pasted Hashnode PAT by querying the `me` field.
   * Per docs/02-SRS.md FR-005: validate via identity endpoint before saving.
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: HashnodeCredentials }> {
    const pat = input.pat;
    if (!pat || typeof pat !== 'string') {
      throw new PublishError('VALIDATION', 'pat (Personal Access Token) is required');
    }

    const query = `
      query {
        me {
          id
          username
          publications(first: 1) {
            nodes {
              id
              title
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
        `Hashnode validation failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as {
      data?: {
        me?: {
          id: string;
          username: string;
          publications?: { nodes: Array<{ id: string; title: string }> };
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

    return {
      identity: {
        id: data.data.me.id,
        username: data.data.me.username,
      },
      credentials: {
        pat,
        publicationId: data.data.me.publications?.nodes[0]?.id,
      },
    };
  }

  /**
   * Publish a markdown article to the user's Hashnode publication.
   *
   * Endpoint: POST /graphql (Hashnode GraphQL API v2)
   * Mutation: publishPost(input: { publicationId, ... })
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
        'Hashnode publicationId missing — user must reconnect to republish their publication'
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
        `Hashnode publish failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as {
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
