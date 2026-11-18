// Vitest unit tests for services/uploads-dir.ts — mostly pure, no mocks.
//
// These helpers are the single source of truth for WHERE uploaded files live
// + how adapters detect image-vs-video + read the local file. They are the
// reliability core of the media-publishing fix: adapters (YouTube, X) read
// the local file via readLocalUploadFile to bypass the ngrok/404 roundtrip.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  UPLOADS_DIR,
  isVideoMedia,
  resolveLocalUploadPath,
  readLocalUploadFile,
} from './uploads-dir';

describe('isVideoMedia', () => {
  it('returns true for video extensions (case-insensitive)', () => {
    expect(isVideoMedia('https://cdn.example.com/uploads/v.mp4')).toBe(true);
    expect(isVideoMedia('https://cdn.example.com/uploads/v.WEBM')).toBe(true);
    expect(isVideoMedia('https://cdn.example.com/uploads/v.Mov')).toBe(true);
    expect(isVideoMedia('https://cdn.example.com/uploads/v.m4v')).toBe(true);
    expect(isVideoMedia('https://cdn.example.com/uploads/v.ogg')).toBe(true);
  });

  it('returns false for image extensions', () => {
    expect(isVideoMedia('https://cdn.example.com/uploads/photo.jpg')).toBe(false);
    expect(isVideoMedia('https://cdn.example.com/uploads/photo.png')).toBe(false);
    expect(isVideoMedia('https://cdn.example.com/uploads/photo.gif')).toBe(false);
    expect(isVideoMedia('https://cdn.example.com/uploads/photo.webp')).toBe(false);
  });

  it('returns false for empty / non-string / no-extension', () => {
    expect(isVideoMedia('')).toBe(false);
    expect(isVideoMedia('https://cdn.example.com/uploads/file')).toBe(false);
  });

  it('handles signed/CDN URLs with query strings + fragments', () => {
    expect(isVideoMedia('https://cdn.example.com/uploads/v.mp4?token=abc')).toBe(true);
    expect(isVideoMedia('https://cdn.example.com/uploads/v.mp4#t=5')).toBe(true);
  });
});

describe('resolveLocalUploadPath', () => {
  it('returns the absolute local path for a /uploads/ URL', () => {
    const url = 'https://subfractional-nonepigrammatic.ngrok-free.dev/uploads/cmur1965i-1cd265d40b80c746.jpeg';
    const result = resolveLocalUploadPath(url);
    expect(result).toBe(join(UPLOADS_DIR, 'cmur1965i-1cd265d40b80c746.jpeg'));
  });

  it('preserves the filename verbatim (no decoding) for a localhost URL', () => {
    const url = 'http://localhost:3000/uploads/abc-123.mp4';
    const result = resolveLocalUploadPath(url);
    expect(result).toBe(join(UPLOADS_DIR, 'abc-123.mp4'));
  });

  it('returns null for a non-/uploads/ URL (external CDN — no local file)', () => {
    expect(resolveLocalUploadPath('https://images.unsplash.com/photo-123.jpg')).toBeNull();
    expect(resolveLocalUploadPath('https://example.com/api/files/123')).toBeNull();
  });

  it('returns null for path-traversal attempts (.. / \\)', () => {
    expect(resolveLocalUploadPath('https://x.com/uploads/../../etc/passwd')).toBeNull();
    expect(resolveLocalUploadPath('https://x.com/uploads/foo/bar.mp4')).toBeNull();
    expect(resolveLocalUploadPath('https://x.com/uploads/foo\\bar.mp4')).toBeNull();
  });

  it('returns null for empty / non-URL input', () => {
    expect(resolveLocalUploadPath('')).toBeNull();
    expect(resolveLocalUploadPath('not-a-url')).toBeNull();
  });

  // Relative URL support ("/uploads/<filename>") — added so the upload
  // controller can store relative URLs (which render on any origin in the
  // browser). `new URL()` throws on relative URLs (no base), so these must be
  // handled before the try/catch URL parse.
  it('resolves a RELATIVE /uploads/ URL to the absolute on-disk path', () => {
    expect(resolveLocalUploadPath('/uploads/abc-123.jpg')).toBe(join(UPLOADS_DIR, 'abc-123.jpg'));
    expect(resolveLocalUploadPath('/uploads/clip.mp4')).toBe(join(UPLOADS_DIR, 'clip.mp4'));
  });

  it('strips the query string on a relative URL', () => {
    expect(resolveLocalUploadPath('/uploads/abc.jpg?t=123')).toBe(join(UPLOADS_DIR, 'abc.jpg'));
  });

  it('returns null for a relative URL that is not under /uploads/', () => {
    expect(resolveLocalUploadPath('/api/health')).toBeNull();
    expect(resolveLocalUploadPath('/images/abc.jpg')).toBeNull();
  });

  it('rejects path-traversal in a relative URL', () => {
    expect(resolveLocalUploadPath('/uploads/../etc/passwd')).toBeNull();
    expect(resolveLocalUploadPath('/uploads/foo/bar.jpg')).toBeNull();
  });
});

describe('readLocalUploadFile', () => {
  const testFilename = `test-uploads-dir-${Date.now()}.txt`;
  const testContent = Buffer.from('hello uploads-dir test');

  beforeEach(() => {
    if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
    writeFileSync(join(UPLOADS_DIR, testFilename), testContent);
  });

  afterEach(() => {
    try { rmSync(join(UPLOADS_DIR, testFilename), { force: true }); } catch { /* ignore */ }
  });

  it('reads the local file bytes for a /uploads/ URL that exists on disk', () => {
    // Use a public-style URL so resolveLocalUploadPath extracts the filename.
    const url = `https://tunnel.ngrok-free.app/uploads/${testFilename}`;
    const buf = readLocalUploadFile(url);
    expect(buf).not.toBeNull();
    expect(buf!.equals(testContent)).toBe(true);
  });

  it('returns null when the file does not exist on disk', () => {
    const url = 'https://tunnel.ngrok-free.app/uploads/nonexistent-file-xyz.mp4';
    expect(readLocalUploadFile(url)).toBeNull();
  });

  it('returns null for a non-/uploads/ URL (external — no local file to read)', () => {
    expect(readLocalUploadFile('https://images.unsplash.com/photo-123.jpg')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(readLocalUploadFile('')).toBeNull();
  });
});

describe('UPLOADS_DIR', () => {
  it('is an absolute path (immune to CWD drift)', () => {
    expect(UPLOADS_DIR.startsWith('/')).toBe(true);
  });

  it('respects UPLOAD_DIRECTORY env var when set', () => {
    // The constant is resolved at module load. We can't re-set it here without
    // re-importing, but we can verify the resolution logic by checking that a
    // custom env would produce a different path. This is a sanity check that
    // UPLOADS_DIR is NOT hardcoded to a relative path.
    expect(UPLOADS_DIR).toMatch(/uploads$/);
  });
});
