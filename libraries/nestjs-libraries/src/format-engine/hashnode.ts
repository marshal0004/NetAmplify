// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/hashnode.ts
// NetAmplify — Hashnode formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   Hashnode: markdown, publication optional.
//
// Hashnode accepts markdown and requires tags from its whitelist
// (hashnode.tags.ts). We pass the tags as-is; the adapter will reject
// invalid tags via Hashnode's GraphQL validation.

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags, truncateWithEllipsis } from './truncation';

const HASHNODE_TITLE_LIMIT = 240;
const HASHNODE_TAG_LIMIT = 5;
const HASHNODE_BODY_LIMIT = 100_000;

export const hashnodeFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  _profile: FormatEngineProfile | null,
  options: FormatEngineOptions
): FormattedPost => {
  const title = truncateWithEllipsis(postCard.title, HASHNODE_TITLE_LIMIT);

  const bodyParts: string[] = [];
  if (postCard.summary) {
    bodyParts.push(`> ${postCard.summary}\n`);
  }
  bodyParts.push(postCard.description);
  if (postCard.techStack.length > 0) {
    bodyParts.push(`\n**Tech Stack:** ${postCard.techStack.join(', ')}`);
  }
  const links: string[] = [];
  if (postCard.repoUrl) links.push(`- [Repo](${postCard.repoUrl})`);
  if (postCard.liveUrl) links.push(`- [Live](${postCard.liveUrl})`);
  if (links.length > 0) {
    bodyParts.push('\n' + links.join('\n'));
  }

  let body = bodyParts.join('\n');
  if (body.length > HASHNODE_BODY_LIMIT) {
    body = truncateWithEllipsis(body, HASHNODE_BODY_LIMIT);
  }

  // Build default options from the PostCard (canonical URL + cover image),
  // then MERGE the per-platform options from the publish request (overrides).
  // The Hashnode adapter reads formatted.options.coverImage / .canonicalUrl /
  // .tags / .subtitle. Previously this REPLACED options with only
  // { canonicalUrl, coverImage }, dropping every UI-sent override (tags,
  // subtitle, cover override, etc.).
  const hashnodeDefaults: Record<string, unknown> = {};
  const canonical = postCard.repoUrl || postCard.liveUrl;
  if (canonical) hashnodeDefaults.canonicalUrl = canonical;
  if (postCard.imageUrl) hashnodeDefaults.coverImage = postCard.imageUrl;

  return {
    title,
    body,
    url: postCard.repoUrl || postCard.liveUrl,
    hashtags: toHashtags(postCard.techStack).slice(0, HASHNODE_TAG_LIMIT),
    options: { ...hashnodeDefaults, ...options },
    charCount: body.length,
    limit: HASHNODE_BODY_LIMIT,
  };
};
