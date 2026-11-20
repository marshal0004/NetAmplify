// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/linkedin.ts
// NetAmplify — LinkedIn formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   LinkedIn: plain text ≤3000, line breaks preserved, ≤3 hashtags, link on own line.
//
// LinkedIn doesn't accept markdown — strip it. Line breaks are preserved.
// Link goes on its own line. Max 3 hashtags (LinkedIn penalizes hashtag spam).

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags, stripMarkdown, truncatePreservingUrl } from './truncation';
import { PLATFORM_CONFIG } from '../platforms/config';

const LINKEDIN_LIMIT = PLATFORM_CONFIG.LINKEDIN.charLimit; // 3000

export const linkedinFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  profile: FormatEngineProfile | null,
  options: FormatEngineOptions
): FormattedPost => {
  const hashtags = toHashtags(postCard.techStack).slice(0, 3); // ≤3 hashtags
  const hashtagsLine = hashtags.length > 0 ? hashtags.map((t) => `#${t}`).join(' ') : '';
  const url = postCard.repoUrl || postCard.liveUrl;

  // Title + summary + description (markdown stripped to plain text)
  const titlePart = postCard.title;
  const summaryPart = postCard.summary ? `\n\n${postCard.summary}` : '';
  const descriptionPart = postCard.description ? `\n\n${stripMarkdown(postCard.description)}` : '';
  const profilePart = profile?.name ? `\n\n— ${profile.name}` : '';
  const hashtagsPart = hashtagsLine ? `\n\n${hashtagsLine}` : '';

  const urlPart = url ? `\n${url}` : '';

  const fullBody = `${titlePart}${summaryPart}${descriptionPart}${profilePart}${hashtagsPart}`;
  // Truncate body (description first) while preserving URL
  const { body: truncatedBody, truncated } = truncatePreservingUrl(
    fullBody + hashtagsPart,
    urlPart,
    LINKEDIN_LIMIT
  );

  return {
    title: '', // LinkedIn doesn't have a separate title field; everything in body
    body: truncatedBody,
    url,
    hashtags,
    // Merge the PostCard-derived media URL (default) with the per-platform
    // options from the publish request (overrides). The linkedinFormatter is
    // reused by YouTube, Instagram, Threads, + Facebook — their adapters read
    // formatted.options.imageUrl / .videoUrl / .caption / .title / .tags / .
    // privacyStatus / .categoryId etc. Previously this REPLACED options with
    // only { imageUrl }, silently dropping every per-platform override the UI
    // sent — which is why a per-platform options panel had no effect. Now the
    // PostCard's imageUrl is the default + incoming options win.
    options: {
      ...(postCard.imageUrl ? { imageUrl: postCard.imageUrl } : {}),
      // Multi-media: thread the PostCard's mediaUrls array into formatted.options
      // so adapters that support multiple media (Bluesky, Facebook, X) can read it.
      // Adapters that only support single media use formatted.options.imageUrl
      // (the first/primary media) — backward compatible.
      ...(postCard.mediaUrls && postCard.mediaUrls.length > 0
        ? { mediaUrls: postCard.mediaUrls }
        : {}),
      ...options,
    },
    charCount: truncatedBody.length,
    limit: LINKEDIN_LIMIT,
  };
};
