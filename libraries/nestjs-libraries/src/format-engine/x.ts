// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/x.ts
// NetAmplify — X (Twitter) formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   X: ≤280 chars; tags → #hashtags appended if room; URL counts as 23.
//
// Twitter counts URLs as 23 chars (t.co wrap), but we approximate by
// checking total UTF-16 length — the actual grapheme count is enforced
// by the adapter at publish time. We leave room for: title + body + url
// + hashtags.

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags, truncateWithEllipsis } from './truncation';
import { PLATFORM_CONFIG } from '../platforms/config';

const X_LIMIT = PLATFORM_CONFIG.TWITTER.charLimit; // 280
const X_URL_LENGTH = 23; // t.co wrap length per Twitter docs
const X_HASHTAG_PREFIX = '#';

export const xFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  _profile: FormatEngineProfile | null,
  _options: FormatEngineOptions
): FormattedPost => {
  const hashtags = toHashtags(postCard.techStack);
  const hashtagsLine = hashtags.length > 0
    ? hashtags.map((t) => `${X_HASHTAG_PREFIX}${t}`).join(' ')
    : '';

  const url = postCard.repoUrl || postCard.liveUrl;

  // Reserve space for url (23 chars + 1 newline) + hashtags + newline
  const urlReserve = url ? X_URL_LENGTH + 1 : 0;
  const hashtagsReserve = hashtagsLine.length > 0 ? hashtagsLine.length + 1 : 0;
  const reserved = urlReserve + hashtagsReserve;

  if (reserved >= X_LIMIT) {
    // Reserved content alone exceeds the limit — return minimal
    return {
      title: '',
      body: truncateWithEllipsis('', X_LIMIT),
      url,
      hashtags: [],
      charCount: X_LIMIT,
      limit: X_LIMIT,
    };
  }

  // Available for title + body
  const available = X_LIMIT - reserved;
  const titleBody = `${postCard.title}\n${postCard.summary}\n${postCard.description}`.trim();
  const truncatedBody = truncateWithEllipsis(titleBody, available);

  return {
    title: '', // X doesn't have a separate title field; everything in body
    body: truncatedBody,
    url,
    hashtags,
    charCount: truncatedBody.length + reserved,
    limit: X_LIMIT,
  };
};
