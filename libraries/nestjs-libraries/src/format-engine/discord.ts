// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/discord.ts
// NetAmplify — Discord formatter (pure function).
//
// Per docs/02-SRS.md FR-011:
//   Discord: embed {title ≤256, description ≤4096, fields: tech stack, links}.
//
// Discord embeds are rich-formatted: title (256 chars), description (4096 chars),
// and up to 25 fields (each 256 chars name + 1024 chars value).

import type { Formatter, FormatEnginePostCard, FormatEngineProfile, FormatEngineOptions, FormattedPost } from './types';
import { toHashtags, truncateWithEllipsis } from './truncation';
import { PLATFORM_CONFIG } from '../platforms/config';

const DISCORD_TITLE_LIMIT = 256;
const DISCORD_DESC_LIMIT = 4096;

export const discordFormatter: Formatter = (
  postCard: FormatEnginePostCard,
  _profile: FormatEngineProfile | null,
  _options: FormatEngineOptions
): FormattedPost => {
  const title = truncateWithEllipsis(postCard.title, DISCORD_TITLE_LIMIT);
  // Description: summary + description (markdown)
  const descParts: string[] = [];
  if (postCard.summary) descParts.push(`*${postCard.summary}*`);
  descParts.push(postCard.description);
  const descFull = descParts.join('\n\n');
  const body = truncateWithEllipsis(descFull, DISCORD_DESC_LIMIT);

  const hashtags = toHashtags(postCard.techStack);
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (hashtags.length > 0) {
    fields.push({
      name: 'Tech Stack',
      value: hashtags.map((t) => `\`${t}\``).join(' '),
    });
  }
  const links: string[] = [];
  if (postCard.repoUrl) links.push(`[Repo](${postCard.repoUrl})`);
  if (postCard.liveUrl) links.push(`[Live](${postCard.liveUrl})`);
  if (links.length > 0) {
    fields.push({
      name: 'Links',
      value: links.join(' • '),
    });
  }

  return {
    title,
    body, // Discord adapter will use this as embed description
    url: postCard.repoUrl || postCard.liveUrl,
    hashtags,
    options: { fields }, // Discord adapter reads options.fields for embed fields
    charCount: body.length,
    limit: DISCORD_DESC_LIMIT,
  };
};
