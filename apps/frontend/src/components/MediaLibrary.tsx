// /home/z/my-project/netamplify-ref/apps/frontend/src/components/MediaLibrary.tsx
// NetAmplify — MediaLibrary component (postflare-style reusable media grid).
//
// Shows the user's previously uploaded media (images + videos) as a thumbnail
// grid. Click a thumbnail to select it for the current PostCard (no re-upload
// needed — the URL is reused). Hover + click × to delete a media file.
//
// Backed by GET /api/media (list) + DELETE /api/media/:filename. The library
// is user-scoped (the backend filters by the `${userId}-` filename prefix).

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mediaApi } from '@/lib/api';
import { MediaPreview } from './MediaPreview';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MediaLibraryProps {
  /** Called when the user picks a media item (the URL is set on the PostCard). */
  onSelect: (url: string) => void;
  /** The currently-selected URL (to highlight in the grid). */
  selectedUrl?: string;
  /** Whether to show the "Upload new" button (default true). */
  showUploadButton?: boolean;
  /** Triggered when the user clicks "Upload new" (parent opens the file input). */
  onUploadNew?: () => void;
}

export function MediaLibrary({
  onSelect,
  selectedUrl,
  showUploadButton = true,
  onUploadNew,
}: MediaLibraryProps) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data: media, isLoading, error } = useQuery({
    queryKey: ['media-library'],
    queryFn: () => mediaApi.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => mediaApi.delete(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library'] });
      setDeleting(null);
    },
  });

  return (
    <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-white">Media Library</CardTitle>
          {showUploadButton && onUploadNew && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onUploadNew}
              className="border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
            >
              + Upload new
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-white/40">Loading your media…</p>}
        {error && <p className="text-sm text-red-400">Could not load media library.</p>}
        {!isLoading && !error && media && media.length === 0 && (
          <p className="text-sm text-white/30">
            No media yet. Upload an image or video to reuse it across PostCards.
          </p>
        )}
        {media && media.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {media.map((item) => (
              <div
                key={item.filename}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border transition-all ${
                  selectedUrl === item.url
                    ? 'border-indigo-500 ring-2 ring-indigo-500/50'
                    : 'border-white/10 hover:border-indigo-500/50'
                }`}
                onClick={() => onSelect(item.url)}
                title={item.filename}
              >
                <div className="aspect-square bg-black/40">
                  <MediaPreview
                    src={item.url}
                    alt={item.filename}
                    controls={false}
                    className="h-full w-full object-cover"
                  />
                </div>
                {item.isVideo && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
                    VIDEO
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(item.filename);
                    deleteMutation.mutate(item.filename);
                  }}
                  disabled={deleting === item.filename}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/80 text-xs text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100"
                  title="Delete media"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
