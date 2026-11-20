// /home/z/my-project/netamplify-app/apps/frontend/src/components/LivePreviewGrid.test.tsx
// Vitest component tests for LivePreviewGrid — real DOM rendering via
// @testing-library/react, NO mocks. The component is pure (props in, JSX out),
// so we pass real PostCard + Preview fixtures and assert the actual DOM.
//
// These tests pin the two behaviours that were broken in the previous inline
// Live Preview block:
//   1. The grid MUST be 2-per-row on desktop (md:grid-cols-2) — previously
//      `space-y-4` stacked one card per row.
//   2. Each per-platform card MUST render the PostCard's media (image OR
//      video) — previously only formatted text was rendered and media was
//      invisible in every per-platform preview.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LivePreviewGrid } from './LivePreviewGrid';
import type { PostCard, Preview } from '@/lib/api';

// --- Real fixtures (match the PostCard + Preview schemas in api.ts) ---
const imageCard: PostCard = {
  id: 'card-1',
  title: 'Ship It',
  summary: 'A postcard about shipping',
  description: 'Long description body text here.',
  techStack: ['react', 'node'],
  repoUrl: 'https://github.com/example/repo',
  liveUrl: 'https://example.com',
  imageUrl: '/uploads/photo-123.jpg',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const previewOf = (platform: string, body: string): Preview => ({
  platform,
  formatted: {
    title: `Title for ${platform}`,
    body,
    url: 'https://example.com',
    hashtags: ['react', 'node'],
    charCount: body.length,
    limit: 2200,
  },
});

// Mirror of PublishPage's platformName helper (capitalizes the enum).
const platformName = (p: string) => p.charAt(0) + p.slice(1).toLowerCase();

describe('LivePreviewGrid', () => {
  it('renders nothing when no platforms are selected', () => {
    const { container } = render(
      <LivePreviewGrid
        card={imageCard}
        selectedPlatforms={new Set()}
        previews={{}}
        platformName={platformName}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('lays out selected platforms in a 2-per-row grid (md:grid-cols-2)', () => {
    render(
      <LivePreviewGrid
        card={imageCard}
        selectedPlatforms={new Set(['INSTAGRAM', 'YOUTUBE', 'DEVTO'])}
        previews={{
          INSTAGRAM: previewOf('INSTAGRAM', 'ig body'),
          YOUTUBE: previewOf('YOUTUBE', 'yt body'),
          DEVTO: previewOf('DEVTO', 'devto body'),
        }}
        platformName={platformName}
      />,
    );

    // Exactly one grid container, and it carries the 2-per-row breakpoint.
    const grids = document.getElementsByClassName('md:grid-cols-2');
    expect(grids).toHaveLength(1);
    expect(grids[0].className).toContain('grid');
    expect(grids[0].className).toContain('md:grid-cols-2');

    // All three platform headers render inside that grid (one card each).
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('Youtube')).toBeInTheDocument();
    expect(screen.getByText('Devto')).toBeInTheDocument();
  });

  it('renders an <img> on EVERY platform card when imageUrl is an image', () => {
    render(
      <LivePreviewGrid
        card={imageCard} // imageUrl = /uploads/photo-123.jpg
        selectedPlatforms={new Set(['INSTAGRAM', 'YOUTUBE'])}
        previews={{
          INSTAGRAM: previewOf('INSTAGRAM', 'ig'),
          YOUTUBE: previewOf('YOUTUBE', 'yt'),
        }}
        platformName={platformName}
      />,
    );

    const imgs = screen.getAllByRole('img') as HTMLImageElement[];
    expect(imgs).toHaveLength(2); // one per platform card
    imgs.forEach((img) => {
      // jsdom resolves relative src against the document base URL; assert the
      // path is present rather than the full resolved URL.
      expect(img.getAttribute('src')).toBe('/uploads/photo-123.jpg');
    });
  });

  it('renders a <video> on EVERY platform card when imageUrl is a video', () => {
    const videoCard: PostCard = { ...imageCard, imageUrl: '/uploads/clip-9.mp4' };
    render(
      <LivePreviewGrid
        card={videoCard}
        selectedPlatforms={new Set(['INSTAGRAM', 'YOUTUBE'])}
        previews={{
          INSTAGRAM: previewOf('INSTAGRAM', 'ig'),
          YOUTUBE: previewOf('YOUTUBE', 'yt'),
        }}
        platformName={platformName}
      />,
    );

    const videos = document.getElementsByTagName('video');
    expect(videos).toHaveLength(2); // one per platform card
    Array.from(videos).forEach((v) => {
      expect(v.getAttribute('src')).toBe('/uploads/clip-9.mp4');
    });
    // No <img> should be present when the media is a video.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a "No media attached" note and NO img/video when imageUrl is null', () => {
    const textOnlyCard: PostCard = { ...imageCard, imageUrl: null };
    render(
      <LivePreviewGrid
        card={textOnlyCard}
        selectedPlatforms={new Set(['INSTAGRAM'])}
        previews={{ INSTAGRAM: previewOf('INSTAGRAM', 'body') }}
        platformName={platformName}
      />,
    );

    expect(screen.getByText(/No media attached/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.getElementsByTagName('video')).toHaveLength(0);
    // Formatted text still renders under the note.
    expect(screen.getByText('Title for INSTAGRAM')).toBeInTheDocument();
  });

  it('truncates the formatted body at 500 chars when no char limit is known', () => {
    const longBody = 'B'.repeat(600);
    const { container } = render(
      <LivePreviewGrid
        card={imageCard}
        selectedPlatforms={new Set(['INSTAGRAM'])}
        previews={{ INSTAGRAM: { ...previewOf('INSTAGRAM', longBody), formatted: { ...previewOf('INSTAGRAM', longBody).formatted, limit: 0 } } }}
        platformName={platformName}
      />,
    );
    // When limit is 0 (unknown), the display truncates at 500 + ellipsis
    expect(container.textContent).toContain('B'.repeat(500) + '…');
    // The remaining 100 chars should NOT be visible
    expect(container.textContent).not.toContain('B'.repeat(501));
  });

  it('highlights text over the platform char limit in red (overflow warning)', () => {
    // Set a small limit (100) so the 200-char body overflows by 100 chars.
    const body = 'X'.repeat(200);
    const { container } = render(
      <LivePreviewGrid
        card={imageCard}
        selectedPlatforms={new Set(['INSTAGRAM'])}
        previews={{ INSTAGRAM: { ...previewOf('INSTAGRAM', body), formatted: { ...previewOf('INSTAGRAM', body).formatted, limit: 100, charCount: 200 } } }}
        platformName={platformName}
      />,
    );
    // The full text is present (100 visible + 100 overflow in red span)
    expect(container.textContent).toContain('X'.repeat(100));
    // The overflow span exists with line-through styling (use line-through
    // selector to avoid matching the char-counter badge which is also red)
    const overflowSpan = container.querySelector('[class*="line-through"]');
    expect(overflowSpan).not.toBeNull();
    expect(overflowSpan?.textContent).toContain('X');
  });

  it('shows a loading state for a platform whose preview has not loaded yet', () => {
    render(
      <LivePreviewGrid
        card={imageCard}
        selectedPlatforms={new Set(['INSTAGRAM', 'YOUTUBE'])}
        previews={{ INSTAGRAM: previewOf('INSTAGRAM', 'ig') }} // YOUTUBE missing
        platformName={platformName}
      />,
    );
    expect(screen.getByText(/Loading preview/i)).toBeInTheDocument();
    // The loaded platform's body still shows.
    expect(screen.getByText('Title for INSTAGRAM')).toBeInTheDocument();
  });

  it('renders the formatted URL and hashtags under the body', () => {
    render(
      <LivePreviewGrid
        card={imageCard}
        selectedPlatforms={new Set(['INSTAGRAM'])}
        previews={{ INSTAGRAM: previewOf('INSTAGRAM', 'body') }}
        platformName={platformName}
      />,
    );
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText('#react #node')).toBeInTheDocument();
  });
});
