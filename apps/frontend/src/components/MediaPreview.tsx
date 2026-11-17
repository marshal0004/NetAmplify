// NetAmplify — MediaPreview component (image OR video, inferred from URL).
//
// The upload endpoint (POST /api/upload) returns { url, filename, mimeType }
// for any accepted file (jpg/png/gif/webp/mp4). The PostCard stores only the
// single `imageUrl` string — no mime type is persisted — so to render the
// correct element we infer the media type from the URL extension.
//
// Used by: Dashboard grid thumbnail, PostCardView detail, PostCardComposer
// in-form preview, PublishPage postcard summary. Consolidating here ensures
// every surface renders video as <video> (with controls) and images as <img>,
// instead of the previous behavior where every surface used <img> only and an
// uploaded .mp4 showed a broken-image placeholder.

const VIDEO_RE = /\.(mp4|webm|mov|ogg|m4v)$/i;

/** True if the URL looks like a video file (by extension). */
export function isVideoUrl(url: string): boolean {
  // Strip query string + fragment first, so signed/CDN URLs like
  // ".../video.mp4?token=abc" or ".../video.mp4#t=5" still detect correctly.
  // Without this, a video URL with any query param would render as <img>.
  return VIDEO_RE.test(url.split(/[?#]/)[0]);
}

interface MediaPreviewProps {
  src: string;
  alt?: string;
  className?: string;
  /** Whether the <video> shows controls. Defaults true. Set false for a mute thumbnail. */
  controls?: boolean;
}

/**
 * Render an <img> or <video> based on the URL extension. Returns null if src
 * is empty (so callers can do `<MediaPreview src={card.imageUrl} … />` without
 * a separate truthy guard).
 */
export function MediaPreview({ src, alt, className, controls = true }: MediaPreviewProps) {
  if (!src) return null;
  if (isVideoUrl(src)) {
    return (
      <video
        src={src}
        controls={controls}
        className={className}
        preload="metadata"
      />
    );
  }
  return <img src={src} alt={alt ?? ''} className={className} />;
}
