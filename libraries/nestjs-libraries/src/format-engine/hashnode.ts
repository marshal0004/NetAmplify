// libraries/nestjs-libraries/src/format-engine/hashnode.ts
// NetAmplify — Hashnode formatter (TOMBSTONE).
// Hashnode was removed (requires Pro plan for API publishing).
// This file exists ONLY so the FORMATTERS Record<Platform, Formatter>
// type-checks (the Prisma Platform enum retains HASHNODE for data compat).
// It is never called at runtime (no adapter is registered).

import type { Formatter } from './types';

export const hashnodeFormatter: Formatter = (postCard) => ({
  title: postCard.title,
  body: postCard.description,
  url: postCard.repoUrl || postCard.liveUrl,
  hashtags: [],
  options: {},
  charCount: postCard.description.length,
  limit: 100000,
});
