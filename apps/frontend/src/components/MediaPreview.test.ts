// Vitest unit tests for MediaPreview / isVideoUrl — pure function, no mocks.
//
// The PostCard stores only a single `imageUrl` string (no mime type), so the
// frontend infers image-vs-video from the URL extension. These tests pin the
// exact behavior so an uploaded .mp4 renders as <video> (with controls) and
// an uploaded .jpg renders as <img> — across all four surfaces that use
// MediaPreview (Dashboard grid, PostCardView, PostCardComposer, PublishPage).
// They also guard against the signed-URL regression where a "?token=..." query
// string would have hidden the extension.

import { describe, it, expect } from 'vitest';
import { isVideoUrl } from './MediaPreview';

describe('isVideoUrl', () => {
  it('returns true for video extensions (case-insensitive)', () => {
    expect(isVideoUrl('https://cdn.example.com/uploads/v.mp4')).toBe(true);
    expect(isVideoUrl('https://cdn.example.com/uploads/v.WEBM')).toBe(true);
    expect(isVideoUrl('https://cdn.example.com/uploads/v.Mov')).toBe(true);
    expect(isVideoUrl('https://cdn.example.com/uploads/v.ogg')).toBe(true);
    expect(isVideoUrl('https://cdn.example.com/uploads/v.m4v')).toBe(true);
  });

  it('returns false for image extensions', () => {
    expect(isVideoUrl('https://cdn.example.com/uploads/photo.jpg')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/uploads/photo.png')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/uploads/photo.gif')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/uploads/photo.webp')).toBe(false);
  });

  it('returns false for URLs with no recognized video extension', () => {
    expect(isVideoUrl('https://cdn.example.com/uploads/file')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/uploads/')).toBe(false);
    expect(isVideoUrl('')).toBe(false);
  });

  it('detects video even with a query string or fragment (signed/CDN URLs)', () => {
    expect(isVideoUrl('https://cdn.example.com/uploads/v.mp4?token=abc&expires=123')).toBe(true);
    expect(isVideoUrl('https://cdn.example.com/uploads/v.mp4#t=5')).toBe(true);
    expect(isVideoUrl('https://cdn.example.com/uploads/v.webm?sig=x#frag')).toBe(true);
  });

  it('does not false-positive on a query param that happens to contain ".mp4"', () => {
    // The extension check runs on the path (before ?/#), so a non-video path
    // with "?ref=video.mp4" must NOT be detected as video.
    expect(isVideoUrl('https://cdn.example.com/uploads/photo.jpg?ref=video.mp4')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/uploads/photo.png#video.mp4')).toBe(false);
  });

  it('returns false for a path that merely ends in ".mp4" as a substring of a longer token', () => {
    // ".mp4x" is not a video extension.
    expect(isVideoUrl('https://cdn.example.com/uploads/file.mp4x')).toBe(false);
  });
});
