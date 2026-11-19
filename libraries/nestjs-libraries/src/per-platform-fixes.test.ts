// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/per-platform-fixes.test.ts
// Regression tests for the two root-cause fixes in this change:
//
//   1. POSTCARD_CREATE_SCHEMA.imageUrl now accepts RELATIVE URLs
//      ("/uploads/<filename>") — the upload controller stores relative URLs
//      so media renders on any origin. A strict z.string().url() rejected
//      them → 400 on POST /api/postcards every time the user uploaded media
//      from their device. (MEDIA_URL_SCHEMA.)
//
//   2. Every formatter now MERGES the incoming per-platform `options` with
//      the PostCard-derived defaults (instead of replacing them). Previously
//      the linkedin/x/devto/hashnode formatters built `options` from only
//      postCard.imageUrl + DROPPED the publish request's options — so the
//      per-platform options panel had no effect. Now overrides (YouTube
//      title/tags/privacy, Hashnode tags/subtitle, Instagram caption, DevTo
//      tags/published, Bluesky altText) flow through to formatted.options +
//      reach the adapters.
//
// These are pure-function tests (no fetch mocking) — they lock in the
// schema + formatter contract that the PublishPage per-platform UI depends on.

import { describe, it, expect } from 'vitest';
import {
  POSTCARD_CREATE_SCHEMA,
  POSTCARD_UPDATE_SCHEMA,
} from './validation/schemas';
import { formatForPlatform } from './format-engine';
import type { FormatEnginePostCard } from './format-engine';

const CARD: FormatEnginePostCard = {
  title: 'My Project',
  summary: 'A one-line summary',
  description: 'The full markdown body of the post.',
  techStack: ['react', 'node'],
  repoUrl: 'https://github.com/user/repo',
  liveUrl: 'https://example.com',
  imageUrl: '/uploads/abc-123.jpg',
};

describe('MEDIA_URL_SCHEMA — PostCard imageUrl accepts relative URLs', () => {
  it('accepts a relative /uploads/ URL (the upload controller format)', () => {
    const r = POSTCARD_CREATE_SCHEMA.safeParse({
      title: 'T',
      summary: 'S',
      description: 'D',
      techStack: ['x'],
      imageUrl: '/uploads/abc-123.jpg',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a full https URL (external CDN)', () => {
    const r = POSTCARD_CREATE_SCHEMA.safeParse({
      title: 'T',
      summary: 'S',
      description: 'D',
      techStack: ['x'],
      imageUrl: 'https://cdn.example.com/img.jpg',
    });
    expect(r.success).toBe(true);
  });

  it('accepts an empty string (no media)', () => {
    const r = POSTCARD_CREATE_SCHEMA.safeParse({
      title: 'T',
      summary: 'S',
      description: 'D',
      techStack: ['x'],
      imageUrl: '',
    });
    expect(r.success).toBe(true);
  });

  it('rejects plain text that is neither a URL nor a relative path', () => {
    const r = POSTCARD_CREATE_SCHEMA.safeParse({
      title: 'T',
      summary: 'S',
      description: 'D',
      techStack: ['x'],
      imageUrl: 'not-a-url',
    });
    expect(r.success).toBe(false);
  });

  it('POSTCARD_UPDATE_SCHEMA (partial) also accepts relative imageUrl', () => {
    const r = POSTCARD_UPDATE_SCHEMA.safeParse({ imageUrl: '/uploads/x.png' });
    expect(r.success).toBe(true);
  });
});

describe('format-engine — formatters merge incoming per-platform options', () => {
  it('YouTube (linkedin formatter) keeps imageUrl default + applies title override', () => {
    const out = formatForPlatform('YOUTUBE', CARD, null, { title: 'Override Title' });
    expect(out.options?.imageUrl).toBe('/uploads/abc-123.jpg');
    expect(out.options?.title).toBe('Override Title');
  });

  it('Instagram (linkedin formatter) keeps imageUrl + applies caption override', () => {
    const out = formatForPlatform('INSTAGRAM', CARD, null, { caption: 'Custom IG caption' });
    expect(out.options?.imageUrl).toBe('/uploads/abc-123.jpg');
    expect(out.options?.caption).toBe('Custom IG caption');
  });

  it('YouTube with NO imageUrl on the card still passes through options', () => {
    const out = formatForPlatform('YOUTUBE', { ...CARD, imageUrl: undefined }, null, {
      title: 'T',
      privacyStatus: 'unlisted',
    });
    expect(out.options?.title).toBe('T');
    expect(out.options?.privacyStatus).toBe('unlisted');
    // No imageUrl default when the card has none — but no key clobbering either.
    expect(out.options?.imageUrl).toBeUndefined();
  });

  it('X (x formatter) keeps imageUrl default + merges override', () => {
    const out = formatForPlatform('TWITTER', CARD, null, { foo: 'bar' });
    expect(out.options?.imageUrl).toBe('/uploads/abc-123.jpg');
    expect(out.options?.foo).toBe('bar');
  });

  it('DevTo (devto formatter) keeps imageUrl + canonicalUrl defaults + applies tags override', () => {
    const out = formatForPlatform('DEVTO', CARD, null, { tags: ['custom1', 'custom2'] });
    expect(out.options?.imageUrl).toBe('/uploads/abc-123.jpg');
    expect(out.options?.canonicalUrl).toBe('https://github.com/user/repo');
    expect(out.options?.tags).toEqual(['custom1', 'custom2']);
  });

  it('Hashnode (hashnode formatter) keeps coverImage + canonicalUrl defaults + applies subtitle override', () => {
    const out = formatForPlatform('HASHNODE', CARD, null, { subtitle: 'A subtitle' });
    expect(out.options?.coverImage).toBe('/uploads/abc-123.jpg');
    expect(out.options?.canonicalUrl).toBe('https://github.com/user/repo');
    expect(out.options?.subtitle).toBe('A subtitle');
  });

  it('Bluesky (bluesky formatter) keeps imageUrl default + applies altText override', () => {
    const out = formatForPlatform('BLUESKY', CARD, null, { altText: 'A screen reader description' });
    expect(out.options?.imageUrl).toBe('/uploads/abc-123.jpg');
    expect(out.options?.altText).toBe('A screen reader description');
  });

  it('Discord (discord formatter) keeps fields default + merges override', () => {
    const out = formatForPlatform('DISCORD', CARD, null, { extra: 'x' });
    expect(Array.isArray(out.options?.fields)).toBe(true);
    expect(out.options?.extra).toBe('x');
  });

  it('Telegram / Mastodon / WordPress pass through incoming options', () => {
    for (const p of ['TELEGRAM', 'MASTODON', 'WORDPRESS'] as const) {
      const out = formatForPlatform(p, CARD, null, { custom: 'v' });
      expect(out.options?.custom).toBe('v');
    }
  });

  it('incoming options OVERRIDE the PostCard-derived default (user wins)', () => {
    // User picks a different video URL for YouTube than the card's imageUrl.
    const out = formatForPlatform('YOUTUBE', CARD, null, {
      imageUrl: 'https://cdn.example.com/other.mp4',
    });
    expect(out.options?.imageUrl).toBe('https://cdn.example.com/other.mp4');
  });
});
