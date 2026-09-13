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
  _options: FormatEngineOptions
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

  return {
    title,
    body,
    url: postCard.repoUrl || postCard.liveUrl,
    hashtags: toHashtags(postCard.techStack).slice(0, DEVTO_TAG_LIMIT),
    options: { main_image: postCard.imageUrl, canonical_url: postCard.repoUrl || postCard.liveUrl },
    charCount: body.length,
    limit: DEVTO_BODY_LIMIT,
  };
};
