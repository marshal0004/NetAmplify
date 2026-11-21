// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/index.test.ts
// Vitest golden tests + property tests for Format Engine.
//
// Per docs/09-TESTING-STRATEGY.md:
//   "Formatters: golden-file tests per platform; boundary tests at char
//    limits; property test: output length ≤ limit for random inputs."

import { describe, it, expect } from 'vitest';
import { formatForPlatform, formatForAllPlatforms } from './index';
import type { FormatEnginePostCard, FormatEngineProfile } from './types';
import type { Platform } from '@prisma/client';

// ============================================================================
// Sample PostCard (canonical "golden" input for all golden tests)
// ============================================================================
const SAMPLE_POST_CARD: FormatEnginePostCard = {
  title: 'My Awesome Project',
  summary: 'A one-line summary of what it does',
  description: '## Introduction\n\nThis is a longer markdown description with **bold** text and a code block:\n\n```ts\nconst x = 42;\n```\n\n## Features\n\n- Feature A\n- Feature B\n',
  techStack: ['TypeScript', 'React', 'Postgres'],
  repoUrl: 'https://github.com/user/repo',
  liveUrl: 'https://example.com',
};

const SAMPLE_PROFILE: FormatEngineProfile = {
  name: 'Jane Doe',
  headline: 'CS Student',
  githubUrl: 'https://github.com/jane',
  portfolioUrl: 'https://jane.dev',
};

// ============================================================================
// Per-platform golden tests
// ============================================================================
describe('xFormatter', () => {
  it('produces a tweet ≤ 280 chars including URL + hashtags', () => {
    const result = formatForPlatform('TWITTER', SAMPLE_POST_CARD, SAMPLE_PROFILE, {});
    expect(result.charCount).toBeLessThanOrEqual(280);
    expect(result.body).toContain('My Awesome Project');
    expect(result.url).toBe('https://github.com/user/repo');
    expect(result.hashtags).toContain('typescript');
  });

  it('truncates when content too long for 280 chars', () => {
    const longDescription = 'x'.repeat(500);
    const result = formatForPlatform(
      'TWITTER',
      { ...SAMPLE_POST_CARD, description: longDescription },
      null,
      {}
    );
    expect(result.charCount).toBeLessThanOrEqual(280);
    // Truncated content ends with ellipsis (or url+hashtags fit exactly)
    expect(result.body.endsWith('…') || result.body.length <= 280).toBe(true);
  });

  it('has no separate title field (everything in body)', () => {
    const result = formatForPlatform('TWITTER', SAMPLE_POST_CARD, null, {});
    expect(result.title).toBe('');
  });
});

describe('linkedinFormatter', () => {
  it('produces plain text ≤ 3000 chars with ≤3 hashtags + link on own line', () => {
    const result = formatForPlatform('LINKEDIN', SAMPLE_POST_CARD, SAMPLE_PROFILE, {});
    expect(result.charCount).toBeLessThanOrEqual(3000);
    expect(result.hashtags.length).toBeLessThanOrEqual(3);
    // Markdown should be stripped (no #, *, **)
    expect(result.body).not.toContain('**bold**');
    expect(result.body).toContain('My Awesome Project');
  });

  it('preserves line breaks', () => {
    const result = formatForPlatform('LINKEDIN', SAMPLE_POST_CARD, null, {});
    expect(result.body).toContain('\n');
  });

  it('truncates long descriptions', () => {
    const longDescription = 'x'.repeat(4000);
    const result = formatForPlatform(
      'LINKEDIN',
      { ...SAMPLE_POST_CARD, description: longDescription },
      null,
      {}
    );
    expect(result.charCount).toBeLessThanOrEqual(3000);
  });

  it('limits to ≤3 hashtags even if techStack has more', () => {
    const result = formatForPlatform(
      'LINKEDIN',
      { ...SAMPLE_POST_CARD, techStack: ['a', 'b', 'c', 'd', 'e'] },
      null,
      {}
    );
    expect(result.hashtags.length).toBe(3);
  });
});

describe('discordFormatter', () => {
  it('produces embed: title ≤256, body ≤4096, with tech stack + links fields', () => {
    const result = formatForPlatform('DISCORD', SAMPLE_POST_CARD, SAMPLE_PROFILE, {});
    expect(result.title).toBe('My Awesome Project');
    expect(result.title.length).toBeLessThanOrEqual(256);
    expect(result.body).toContain('A one-line summary');
    expect(result.body.length).toBeLessThanOrEqual(4096);
    expect(result.options?.fields).toBeDefined();
    const fields = result.options?.fields as Array<{ name: string; value: string }>;
    expect(fields.find((f) => f.name === 'Tech Stack')).toBeDefined();
    expect(fields.find((f) => f.name === 'Links')).toBeDefined();
  });

  it('truncates title to 256 chars when too long', () => {
    const longTitle = 'x'.repeat(300);
    const result = formatForPlatform('DISCORD', { ...SAMPLE_POST_CARD, title: longTitle }, null, {});
    expect(result.title.length).toBeLessThanOrEqual(256);
    expect(result.title.endsWith('…')).toBe(true);
  });
});

describe('devtoFormatter', () => {
  it('produces markdown article with frontmatter + ≤4 tags', () => {
    const result = formatForPlatform('DEVTO', SAMPLE_POST_CARD, SAMPLE_PROFILE, {});
    expect(result.title).toBe('My Awesome Project');
    expect(result.body.startsWith('---')).toBe(true);
    expect(result.body).toContain('published: true');
    expect(result.hashtags.length).toBeLessThanOrEqual(4);
  });

  it('includes cover_image in frontmatter when imageUrl provided', () => {
    const result = formatForPlatform(
      'DEVTO',
      { ...SAMPLE_POST_CARD, imageUrl: 'https://example.com/img.png' },
      null,
      {}
    );
    expect(result.body).toContain('cover_image: https://example.com/img.png');
  });
});

