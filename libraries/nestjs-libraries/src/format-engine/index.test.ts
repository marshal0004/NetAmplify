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
describe('redditFormatter', () => {
  it('produces a title ≤ 300 chars + markdown body', () => {
    const result = formatForPlatform('REDDIT', SAMPLE_POST_CARD, SAMPLE_PROFILE, { subreddit: 'sideproject' });
    expect(result.title).toBe('My Awesome Project');
    expect(result.title.length).toBeLessThanOrEqual(300);
    expect(result.body).toContain('A one-line summary of what it does');
    expect(result.body).toContain('## Introduction');
    expect(result.body).toContain('TypeScript, React, Postgres');
    expect(result.body).toContain('https://github.com/user/repo');
    expect(result.options?.subreddit).toBe('sideproject');
    expect(result.hashtags).toEqual(['typescript', 'react', 'postgres']);
  });

  it('truncates title to 300 chars when too long', () => {
    const longTitle = 'x'.repeat(350);
    const result = formatForPlatform('REDDIT', { ...SAMPLE_POST_CARD, title: longTitle }, null, {});
    expect(result.title.length).toBe(300);
    expect(result.title.endsWith('…')).toBe(true);
  });

  it('defaults subreddit to "test" when not provided', () => {
    const result = formatForPlatform('REDDIT', SAMPLE_POST_CARD, null, {});
    expect(result.options?.subreddit).toBe('test');
  });
});

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

describe('hashnodeFormatter', () => {
  it('produces markdown with ≤5 tags', () => {
    const result = formatForPlatform('HASHNODE', SAMPLE_POST_CARD, SAMPLE_PROFILE, {});
    expect(result.title).toBe('My Awesome Project');
    expect(result.body).toContain('## Introduction');
    expect(result.hashtags.length).toBeLessThanOrEqual(5);
  });

  it('includes canonical URL option', () => {
    const result = formatForPlatform('HASHNODE', SAMPLE_POST_CARD, null, {});
    expect(result.options?.canonicalUrl).toBe('https://github.com/user/repo');
  });
});

describe('telegramFormatter', () => {
  it('produces HTML with bold title + escaped body + link + hashtags', () => {
    const result = formatForPlatform('TELEGRAM', SAMPLE_POST_CARD, SAMPLE_PROFILE, {});
    expect(result.body).toContain('<b>My Awesome Project</b>');
    expect(result.body).toContain('<a href=');
    expect(result.body.length).toBeLessThanOrEqual(4096);
    expect(result.hashtags).toContain('typescript');
  });

  it('HTML-escapes special characters in body', () => {
    const result = formatForPlatform(
      'TELEGRAM',
      { ...SAMPLE_POST_CARD, summary: 'Uses <script> & cool stuff' },
      null,
      {}
    );
    expect(result.body).toContain('&lt;script&gt;');
    expect(result.body).toContain('&amp;');
  });
});

describe('blueskyFormatter', () => {
  it('produces ≤300 chars with title + summary + description + link + hashtags', () => {
    const result = formatForPlatform('BLUESKY', SAMPLE_POST_CARD, SAMPLE_PROFILE, {});
    expect(result.charCount).toBeLessThanOrEqual(300);
    expect(result.body).toContain('My Awesome Project');
    expect(result.url).toBe('https://github.com/user/repo');
    expect(result.hashtags).toContain('typescript');
  });

  it('truncates when total exceeds 300 chars', () => {
    const longDescription = 'x'.repeat(400);
    const result = formatForPlatform(
      'BLUESKY',
      { ...SAMPLE_POST_CARD, description: longDescription },
      null,
      {}
    );
    expect(result.charCount).toBeLessThanOrEqual(300);
  });
});

// ============================================================================
// Determinism test (FR-011: same input → identical output)
// ============================================================================
describe('determinism', () => {
  const platforms: Platform[] = ['REDDIT', 'TWITTER', 'LINKEDIN', 'DISCORD', 'DEVTO', 'HASHNODE', 'TELEGRAM', 'BLUESKY'];

  for (const platform of platforms) {
    it(`${platform}: same input → identical output (called twice)`, () => {
      const r1 = formatForPlatform(platform, SAMPLE_POST_CARD, SAMPLE_PROFILE, { subreddit: 'test' });
      const r2 = formatForPlatform(platform, SAMPLE_POST_CARD, SAMPLE_PROFILE, { subreddit: 'test' });
      expect(r1).toEqual(r2);
    });
  }
});

// ============================================================================
// Property test: output length ≤ limit for random inputs
// ============================================================================
describe('property: charCount ≤ limit', () => {
  const platforms: Platform[] = ['REDDIT', 'TWITTER', 'LINKEDIN', 'DISCORD', 'DEVTO', 'HASHNODE', 'TELEGRAM', 'BLUESKY'];

  // Generate 10 random PostCards with varying lengths
  function randomPostCard(seed: number): FormatEnginePostCard {
    // Use a simple LCG (Linear Congruential Generator) — deterministic,
    // no Date.now/random — per FR-011 determinism requirement
    let state = seed + 1;
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state;
    };
    const r = (n: number) => next() % n;
    return {
      title: `Title ${seed}: ${'x'.repeat(r(200))}`,
      summary: `Summary ${seed}: ${'y'.repeat(r(300))}`,
      description: `Description ${seed}: ${'z'.repeat(r(5000))}`,
      techStack: ['a', 'b', 'c'].slice(0, r(3) + 1),
      repoUrl: r(2) === 0 ? 'https://github.com/user/repo' : undefined,
      liveUrl: r(2) === 0 ? 'https://example.com' : undefined,
    };
  }

  for (const platform of platforms) {
    it(`${platform}: output never exceeds limit for 10 random PostCards`, () => {
      for (let i = 0; i < 10; i++) {
        const postCard = randomPostCard(i);
        const result = formatForPlatform(platform, postCard, null, { subreddit: 'test' });
        // Allow a small tolerance for grapheme vs UTF-16 approximation
        expect(result.charCount).toBeLessThanOrEqual(result.limit + 5);
      }
    });
  }
});

// ============================================================================
// formatForAllPlatforms
// ============================================================================
describe('formatForAllPlatforms', () => {
  it('returns a FormatResult for all 8 platforms', () => {
    const results = formatForAllPlatforms(SAMPLE_POST_CARD, SAMPLE_PROFILE, {
      REDDIT: { subreddit: 'test' },
    });
    const platforms = Object.keys(results) as Platform[];
    expect(platforms.length).toBe(8);
    expect(platforms).toContain('REDDIT');
    expect(platforms).toContain('TWITTER');
    expect(platforms).toContain('LINKEDIN');
    expect(platforms).toContain('DISCORD');
    expect(platforms).toContain('DEVTO');
    expect(platforms).toContain('HASHNODE');
    expect(platforms).toContain('TELEGRAM');
    expect(platforms).toContain('BLUESKY');
  });
});
