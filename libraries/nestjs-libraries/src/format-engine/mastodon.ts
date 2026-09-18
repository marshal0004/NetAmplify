// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/mastodon.ts
// NetAmplify — Mastodon formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   Mastodon: ≤500 chars; supports hashtags via #tag; supports
//   markdown-ish (line breaks preserved, links auto-linked by the
//   server regardless of length).
//
// Mastodon's character counting rules (per
// https://docs.joinmastodon.org/api/guidelines/#text-fields):
//   - URLs count as their displayed length (NOT 23 like Twitter)
//   - Mentions (@user@instance) count as @user (the instance part is
//     replaced by a mention link at render time)
//   - Hashtags count as displayed (#tag)
//
// For MVP, we approximate by counting UTF-16 length. The adapter enforces
// a hard 500-char cap at publish time.

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags, truncateWithEllipsis } from './truncation';
import { PLATFORM_CONFIG } from '../platforms/config';

const MASTODON_LIMIT = PLATFORM_CONFIG.MASTODON.charLimit; // 500

export const mastodonFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  profile: FormatEngineProfile | null,
  _options: FormatEngineOptions
): FormattedPost => {
  const hashtags = toHashtags(postCard.techStack);
  const hashtagsLine = hashtags.length > 0
    ? `\n\n${hashtags.map((t) => `#${t}`).join(' ')}`
    : '';

  const url = postCard.repoUrl || postCard.liveUrl;
  const urlLine = url ? `\n\n${url}` : '';

  // Reserve space for url + hashtags
  const reserved = urlLine.length + hashtagsLine.length;
  if (reserved >= MASTODON_LIMIT) {
    // Reserved content alone exceeds the limit — return minimal
    return {
      title: '',
      body: truncateWithEllipsis('', MASTODON_LIMIT),
      url,
      hashtags,
      charCount: MASTODON_LIMIT,
      limit: MASTODON_LIMIT,
    };
  }

  const available = MASTODON_LIMIT - reserved;

  // Build body: title + summary + description, with line breaks
  const parts: string[] = [];
  if (postCard.title) parts.push(postCard.title);
  if (postCard.summary) parts.push(postCard.summary);
  if (postCard.description) parts.push(postCard.description);
  if (profile?.name) {
    // Append attribution — Mastodon convention
    parts.push(`\n— ${profile.name}`);
  }
  const fullBody = parts.join('\n\n');
  const truncatedBody = truncateWithEllipsis(fullBody, available);

  return {
    title: '', // Mastodon doesn't have a separate title field
    body: truncatedBody,
    url,
    hashtags,
    charCount: truncatedBody.length + reserved,
    limit: MASTODON_LIMIT,
  };
};
