// /home/z/my-project/na-work/apps/frontend/src/components/EditPostCardDialog.tsx
// NetAmplify — EditPostCardDialog: edit + save a PostCard from the Dashboard grid.
//
// Opens as a modal overlay (no page navigation) so the user can edit any
// PostCard directly from the live-preview grid. Mirrors the PostCardComposer
// field set (title, summary, description, techStack, repoUrl, liveUrl,
// imageUrl) + reuses the upload flow. On save → PATCH /api/postcards/:id →
// invalidate the postcards query → close.
//
// This is the "edit + save in live preview" affordance the Dashboard was
// missing: edit previously required a full page navigation to
// /dashboard/postcards/:id/edit. The dialog keeps the user in the preview,
// which is what was asked for.

import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { postcardApi, type PostCard } from '@/lib/api';
import { getErrorMessage, getFieldErrors } from '@/lib/errors';
import { MediaPreview } from '@/components/MediaPreview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface EditPostCardDialogProps {
  card: PostCard;
  onClose: () => void;
  /** Called after a successful PATCH (the query is invalidated inside). */
  onSaved: () => void;
}

export function EditPostCardDialog({ card, onClose, onSaved }: EditPostCardDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(card.title);
  const [summary, setSummary] = useState(card.summary);
  const [description, setDescription] = useState(card.description);
  const [techStack, setTechStack] = useState<string[]>(card.techStack);
  const [techInput, setTechInput] = useState('');
  const [repoUrl, setRepoUrl] = useState(card.repoUrl ?? '');
  const [liveUrl, setLiveUrl] = useState(card.liveUrl ?? '');
  const [imageUrl, setImageUrl] = useState(card.imageUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape — standard modal affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function addTechTag() {
    const tag = techInput.trim().toLowerCase();
    if (tag && !techStack.includes(tag) && techStack.length < 10) {
      setTechStack([...techStack, tag]);
      setTechInput('');
    }
  }

  async function handleFileUpload(file: File) {
    setUploading(true);
    setFormError(null);
    try {
      const jwtToken = localStorage.getItem('netamplify_token');
      if (!jwtToken) {
        window.dispatchEvent(new CustomEvent('netamplify:unauthorized'));
        setFormError('You must be logged in to NetAmplify. Please log in and try again.');
        return;
      }
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwtToken}` },
        body: formData,
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Upload failed: ${errText}`);
      }
      const data = (await resp.json()) as { url: string };
      setImageUrl(data.url);
      // Invalidate the media library so the new upload appears in the grid.
      queryClient.invalidateQueries({ queryKey: ['media-library'] });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      await postcardApi.update(card.id, {
        title,
        summary,
        description,
        techStack,
        repoUrl: repoUrl || null,
        liveUrl: liveUrl || null,
        imageUrl: imageUrl || null,
      });
      // Refresh the Dashboard grid so the edited card re-renders with new content.
      queryClient.invalidateQueries({ queryKey: ['postcards'] });
      onSaved();
      onClose();
    } catch (err) {
      setErrors(getFieldErrors(err));
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative my-8 w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Edit Post Card</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {formError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {formError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label className="text-white/60">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className="mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20"
            />
            <p className="mt-1 text-xs text-white/30">{title.length}/120</p>
            {errors.title && <p className="text-xs text-red-400">{errors.title}</p>}
          </div>

          <div>
            <Label className="text-white/60">Summary</Label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={200}
              className="mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20"
            />
            <p className="mt-1 text-xs text-white/30">{summary.length}/200</p>
            {errors.summary && <p className="text-xs text-red-400">{errors.summary}</p>}
          </div>

          <div>
            <Label className="text-white/60">Description (Markdown)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              maxLength={5000}
              className="mt-1 font-mono text-sm border-white/10 bg-white/5 text-white placeholder:text-white/20"
            />
            <p className="mt-1 text-xs text-white/30">{description.length}/5000</p>
            {errors.description && <p className="text-xs text-red-400">{errors.description}</p>}
          </div>

          <div>
            <Label className="text-white/60">Tech Stack</Label>
            <div className="mt-1 flex gap-2">
              <Input
                value={techInput}
                onChange={(e) => setTechInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTechTag();
                  }
                }}
                placeholder="Add a technology (press Enter)"
                className="flex-1 border-white/10 bg-white/5 text-white placeholder:text-white/20"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addTechTag}
                className="border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
              >
                Add
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {techStack.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="cursor-pointer bg-indigo-500/10 font-mono text-xs text-indigo-300"
                  onClick={() => setTechStack(techStack.filter((t) => t !== tag))}
                >
                  {tag} ✕
                </Badge>
              ))}
              {techStack.length === 0 && (
                <p className="text-sm text-white/30">No tags yet.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-white/60">Repository URL</Label>
              <Input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                type="url"
                placeholder="https://github.com/user/repo"
                className="mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20"
              />
            </div>
            <div>
              <Label className="text-white/60">Live URL</Label>
              <Input
                value={liveUrl}
                onChange={(e) => setLiveUrl(e.target.value)}
                type="url"
                placeholder="https://example.com"
                className="mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20"
              />
            </div>
          </div>

          <div>
            <Label className="text-white/60">Image / Video</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
              }}
              className="hidden"
            />
            {imageUrl ? (
              <div className="relative mt-2">
                <MediaPreview
                  src={imageUrl}
                  alt="Preview"
                  className="max-h-40 rounded-lg border border-white/10"
                />
                <button
                  type="button"
                  onClick={() => setImageUrl('')}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500/80 text-sm text-white hover:bg-red-500"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => !uploading && fileInputRef.current?.click()}
                className="mt-1 w-full rounded-lg border-2 border-dashed border-white/10 p-6 text-center text-white/40 transition-colors hover:border-indigo-500/50"
              >
                {uploading ? 'Uploading…' : 'Click to upload an image or video'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="border-0 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
