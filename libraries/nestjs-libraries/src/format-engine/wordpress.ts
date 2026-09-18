// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/wordpress.ts
// NetAmplify — WordPress formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   WordPress: full markdown/HTML body, title (≤200), optional tags as
//   categories. WordPress stores raw HTML in post_content; the active
//   theme's rendering pipeline handles display.
//
// For MVP, we pass markdown (which the WordPress block editor + most
// themes render correctly). If the user has a markdown plugin (e.g.,
// Jetpack Markdown), the content is rendered as-is.

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags } from './truncation';
import { PLATFORM_CONFIG } from '../platforms/config';

const WORDPRESS_TITLE_LIMIT = PLATFORM_CONFIG.WORDPRESS.charLimit; // 200
const WORDPRESS_BODY_LIMIT = 100000;

export const wordpressFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  profile: FormatEngineProfile | null,
  _options: FormatEngineOptions
): FormattedPost => {
  const hashtags = toHashtags(postCard.techStack);

  // Title — truncate to 200 chars (WordPress title column is VARCHAR(200))
  const title = postCard.title.length > WORDPRESS_TITLE_LIMIT
    ? postCard.title.slice(0, WORDPRESS_TITLE_LIMIT - 1) + '…'
    : postCard.title;

  // Build body — markdown with summary, description, links, attribution
  const lines: string[] = [];

  if (postCard.summary) {
    lines.push(`> **${postCard.summary}**`);
    lines.push('');
  }

  if (postCard.description) {
    lines.push(postCard.description);
    lines.push('');
  }

  // Links section
  const linkLines: string[] = [];
  if (postCard.repoUrl) {
    linkLines.push(`- 📦 **Source code**: ${postCard.repoUrl}`);
  }
  if (postCard.liveUrl) {
    linkLines.push(`- 🌐 **Live demo**: ${postCard.liveUrl}`);
  }
  if (linkLines.length > 0) {
    lines.push('## Links');
    lines.push('');
    lines.push(...linkLines);
    lines.push('');
  }

  // Tech stack section
  if (postCard.techStack.length > 0) {
    lines.push('## Tech Stack');
    lines.push('');
    lines.push(postCard.techStack.map((t) => `- \`${t}\``).join('\n'));
    lines.push('');
  }

  // Tags section (as hashtags at the bottom — for searchability)
  if (hashtags.length > 0) {
    lines.push(hashtags.map((t) => `#${t}`).join(' '));
    lines.push('');
  }

  // Attribution
  if (profile?.name) {
    lines.push('---');
    lines.push(`*Posted by ${profile.name} via NetAmplify*`);
  }

  const body = lines.join('\n').slice(0, WORDPRESS_BODY_LIMIT);

  return {
    title,
    body,
    url: postCard.repoUrl || postCard.liveUrl,
    hashtags,
    charCount: body.length,
    limit: WORDPRESS_BODY_LIMIT,
  };
};
