// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/reddit.ts
// NetAmplify — Reddit formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   Reddit: title (≤300) + markdown body (uses description verbatim-ish)
//
// Reddit accepts markdown in the body. We use the PostCard description
// (which is markdown) directly + add the summary at the top + repo/live
// links at the bottom. Tech stack becomes a list at the bottom too.

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags } from './truncation';
import { PLATFORM_CONFIG } from '../platforms/config';

const REDDIT_TITLE_LIMIT = PLATFORM_CONFIG.REDDIT.charLimit; // 300
const REDDIT_BODY_LIMIT = 40_000; // Reddit body limit (docs)

export const redditFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  _profile: FormatEngineProfile | null,
  options: FormatEngineOptions
): FormattedPost => {
  // Title: truncate to 300 chars per Reddit limit
  let title = postCard.title;
  let titleTruncated = false;
  if (title.length > REDDIT_TITLE_LIMIT) {
    title = title.slice(0, REDDIT_TITLE_LIMIT - 1) + '…';
    titleTruncated = true;
  }

  // Body: summary line + description + links + tech stack
  const parts: string[] = [];
  if (postCard.summary) parts.push(`> ${postCard.summary}\n`);
  parts.push(postCard.description);
  if (postCard.techStack.length > 0) {
    parts.push(`\n**Tech stack:** ${postCard.techStack.join(', ')}`);
  }
  const links: string[] = [];
  if (postCard.repoUrl) links.push(`- Repo: ${postCard.repoUrl}`);
  if (postCard.liveUrl) links.push(`- Live: ${postCard.liveUrl}`);
  if (links.length > 0) parts.push('\n' + links.join('\n'));
  let body = parts.join('\n');

  let truncated = titleTruncated;
  if (body.length > REDDIT_BODY_LIMIT) {
    body = body.slice(0, REDDIT_BODY_LIMIT - 1) + '…';
    truncated = true;
  }

  return {
    title,
    body,
    hashtags: toHashtags(postCard.techStack),
    options: { subreddit: options.subreddit || 'test' },
    charCount: body.length,
    limit: REDDIT_BODY_LIMIT,
  };
};
