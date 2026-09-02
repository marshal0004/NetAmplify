// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/telegram.ts
// NetAmplify — Telegram formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   Telegram: HTML message ≤4096 with title link + tags.
//
// Telegram supports HTML parsing (parse_mode=HTML) with limited tags:
// <b>, <i>, <a>, <code>, <pre>. No markdown.

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags, stripMarkdown, truncateWithEllipsis } from './truncation';

const TELEGRAM_LIMIT = 4096;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const telegramFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  _profile: FormatEngineProfile | null,
  _options: FormatEngineOptions
): FormattedPost => {
  const url = postCard.repoUrl || postCard.liveUrl;
  const hashtags = toHashtags(postCard.techStack);
  const hashtagsLine = hashtags.length > 0
    ? `\n\n${hashtags.map((t) => `#${t}`).join(' ')}`
    : '';
  const urlLine = url ? `\n<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : '';

  // Build the HTML message: <b>title</b>\n\n<summary>\n\n<body>\n<link>\n\n<hashtags>
  const titleHtml = `<b>${escapeHtml(postCard.title)}</b>`;
  const summaryHtml = postCard.summary ? `\n\n${escapeHtml(stripMarkdown(postCard.summary))}` : '';
  const bodyHtml = postCard.description ? `\n\n${escapeHtml(stripMarkdown(postCard.description))}` : '';

  let body = `${titleHtml}${summaryHtml}${bodyHtml}${urlLine}${hashtagsLine}`;
  // Telegram counts HTML entities' visible length, not raw bytes — we approximate
  if (body.length > TELEGRAM_LIMIT) {
    body = truncateWithEllipsis(body, TELEGRAM_LIMIT);
  }

  return {
    title: postCard.title,
    body,
    url,
    hashtags,
    charCount: body.length,
    limit: TELEGRAM_LIMIT,
  };
};
