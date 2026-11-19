// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/devto.ts
// NetAmplify — Dev.to formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   Dev.to: markdown article (title + body), tags ≤4.
//
// Dev.to accepts full markdown. We use the PostCard description verbatim
// + add cover image (if present) + 4 tags max.

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags, truncateWithEllipsis } from './truncation';

const DEVTO_TITLE_LIMIT = 128;
const DEVTO_TAG_LIMIT = 4;
const DEVTO_BODY_LIMIT = 70_000;

export const devtoFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  _profile: FormatEngineProfile | null,
  options: FormatEngineOptions
): FormattedPost => {
  const title = truncateWithEllipsis(postCard.title, DEVTO_TITLE_LIMIT);

  // Body: cover_image frontmatter + summary + description + tech stack + links
  const frontmatter: string[] = ['---'];
  if (postCard.imageUrl) {
    frontmatter.push(`cover_image: ${postCard.imageUrl}`);
  }
  frontmatter.push('published: true');
  frontmatter.push('---');
  const frontmatterText = frontmatter.join('\n');

  const bodyParts: string[] = [frontmatterText];
  if (postCard.summary) {
    bodyParts.push(`\n> ${postCard.summary}\n`);
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
  if (body.length > DEVTO_BODY_LIMIT) {
    body = truncateWithEllipsis(body, DEVTO_BODY_LIMIT);
  }

  // Build default options from the PostCard (cover image + canonical URL),
  // then MERGE the per-platform options from the publish request (overrides).
  // The DevTo adapter reads formatted.options.imageUrl (for main_image) +
  // formatted.options.canonicalUrl (for canonical_url) + formatted.options.
  // tags / .published (per-platform overrides). Previously this set
  // { main_image, canonical_url } — but the adapter reads `imageUrl`, not
  // `main_image`, so the cover image NEVER reached Dev.to, AND every
  // UI-sent override was dropped. Aligned the key names + merge incoming.
  const devtoDefaults: Record<string, unknown> = {};
  if (postCard.imageUrl) devtoDefaults.imageUrl = postCard.imageUrl;
  const canonical = postCard.repoUrl || postCard.liveUrl;
  if (canonical) devtoDefaults.canonicalUrl = canonical;

  return {
    title,
    body,
    url: postCard.repoUrl || postCard.liveUrl,
    hashtags: toHashtags(postCard.techStack).slice(0, DEVTO_TAG_LIMIT),
    options: { ...devtoDefaults, ...options },
    charCount: body.length,
    limit: DEVTO_BODY_LIMIT,
  };
};
