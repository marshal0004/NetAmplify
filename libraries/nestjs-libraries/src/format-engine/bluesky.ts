// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/bluesky.ts
// NetAmplify — Bluesky formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   Bluesky: ≤300 chars (graphemes) + external link facet.
//
// Bluesky uses grapheme counting (Unicode-aware). The adapter handles
// the actual grapheme verification + link facet construction; here we
// just produce a reasonable text with title + summary + body + link.

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags, stripMarkdown, truncateWithEllipsis } from './truncation';
import { PLATFORM_CONFIG } from '../platforms/config';

const BLUESKY_LIMIT = PLATFORM_CONFIG.BLUESKY.charLimit; // 300

export const blueskyFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  _profile: FormatEngineProfile | null,
  _options: FormatEngineOptions
): FormattedPost => {
  const url = postCard.repoUrl || postCard.liveUrl;
  const hashtags = toHashtags(postCard.techStack);
  const hashtagsLine = hashtags.length > 0
    ? `\n\n${hashtags.map((t) => `#${t}`).join(' ')}`
    : '';
  const urlLine = url ? `\n${url}` : '';

  // Title + summary + body (markdown stripped)
  const titlePart = postCard.title;
  const summaryPart = postCard.summary ? `\n\n${stripMarkdown(postCard.summary)}` : '';
  const descriptionPart = postCard.description ? `\n\n${stripMarkdown(postCard.description)}` : '';

  const fullText = `${titlePart}${summaryPart}${descriptionPart}${urlLine}${hashtagsLine}`;
  // Truncate to 300 graphemes (approximated as UTF-16 chars; adapter does grapheme verification)
  const text = truncateWithEllipsis(fullText, BLUESKY_LIMIT);

  return {
    title: postCard.title,
    body: text,
    url,
    hashtags,
    charCount: Array.from(text).length, // grapheme-ish count
    limit: BLUESKY_LIMIT,
  };
};
