// /home/z/my-project/netamplify-ref/apps/frontend/src/pages/PostCardComposer.tsx
// NetAmplify — PostCard composer (create OR edit).
//
// Postflare-grade composer features:
//   - Media Library grid (reusable uploaded media — no re-upload needed)
//   - Markdown preview (react-markdown + remark-gfm, was naive pre-wrap)
//   - Edit mode (accepts :id via useParams → loads the PostCard → PATCH on save)
//   - Drag-and-drop OR click-to-browse upload (unchanged)
//   - Live char counters per PostCard field (unchanged)
//
// Routing:
//   /dashboard/postcards/new        → create mode (no :id param)
//   /dashboard/postcards/:id/edit   → edit mode (loads + PATCHes the PostCard)

import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { postcardApi } from '@/lib/api';
import { getErrorMessage, getFieldErrors } from '@/lib/errors';
import { MediaPreview } from '@/components/MediaPreview';
import { MediaLibrary } from '@/components/MediaLibrary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function PostCardComposer() {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const isEditMode = Boolean(editId);
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [techStack, setTechStack] = useState<string[]>([]);
  const [techInput, setTechInput] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit mode: load the existing PostCard + populate the form once.
  const { data: existingCard } = useQuery({
    queryKey: ['postcard', editId],
    queryFn: () => postcardApi.get(editId!),
    enabled: !!editId,
  });

  const populatedRef = useRef(false);
  useEffect(() => {
    if (existingCard && !populatedRef.current) {
      setTitle(existingCard.title);
      setSummary(existingCard.summary);
      setDescription(existingCard.description);
      setTechStack(existingCard.techStack);
      setRepoUrl(existingCard.repoUrl ?? '');
      setLiveUrl(existingCard.liveUrl ?? '');
      setImageUrl(existingCard.imageUrl ?? '');
      setImagePreview(existingCard.imageUrl ?? '');
      populatedRef.current = true;
    }
  }, [existingCard]);

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
      const formData = new FormData();
      formData.append('file', file);

      const jwtToken = localStorage.getItem('netamplify_token');
      if (!jwtToken) {
        window.dispatchEvent(new CustomEvent('netamplify:unauthorized'));
        setFormError('You must be logged in to NetAmplify. Please log in and try again.');
        return;
      }
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwtToken}` },
        body: formData,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Upload failed: ${errText}`);
      }

      const data = (await resp.json()) as { url: string; filename: string; mimeType: string };
      setImageUrl(data.url);
      setImagePreview(data.url);
      // Invalidate the media library so the new upload appears in the grid.
      queryClient.invalidateQueries({ queryKey: ['media-library'] });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  }

  function pickFromLibrary(url: string) {
    setImageUrl(url);
    setImagePreview(url);
    setShowMediaLibrary(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setLoading(true);
    try {
      const payload = {
        title,
        summary,
        description,
        techStack,
        repoUrl: repoUrl || undefined,
        liveUrl: liveUrl || undefined,
        imageUrl: imageUrl || undefined,
      };
      const card = isEditMode
        ? await postcardApi.update(editId!, payload)
        : await postcardApi.create(payload);
      navigate(`/dashboard/postcards/${card.id}`);
    } catch (err) {
      setErrors(getFieldErrors(err));
      setFormError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-3xl font-bold text-white"
      >
        {isEditMode ? 'Edit Post Card' : 'New Post Card'}
      </motion.h1>

      {formError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basics */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
          <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
            <CardHeader><CardTitle className="text-white">Basics</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="title" className="text-white/60">Title <span className="text-red-500">*</span></Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} placeholder="My Awesome Project"
                  className="mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50" />
                <p className="mt-1 text-xs text-white/30">{title.length}/120</p>
                {errors.title && <p className="text-xs text-red-400">{errors.title}</p>}
              </div>
              <div>
                <Label htmlFor="summary" className="text-white/60">Summary <span className="text-red-500">*</span></Label>
                <Input id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} required maxLength={200} placeholder="A one-line summary"
                  className="mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50" />
                <p className="mt-1 text-xs text-white/30">{summary.length}/200</p>
                {errors.summary && <p className="text-xs text-red-400">{errors.summary}</p>}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Story (Markdown) — react-markdown preview */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}>
          <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Story (Markdown)</CardTitle>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)} className="text-white/50 hover:text-white">
                  {showPreview ? 'Edit' : 'Preview'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {showPreview ? (
                <div className="prose prose-sm prose-invert max-w-none rounded-lg border border-white/5 bg-black/30 p-4 text-white/70">
                  <h1>{title}</h1>
                  <p><em>{summary}</em></p>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
                </div>
              ) : (
                <div>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={5000} rows={12}
                    placeholder="## Introduction&#10;&#10;Describe your project here. Markdown supported (headings, **bold**, lists, code, links)."
                    className="font-mono text-sm border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50" />
                  <p className="mt-1 text-xs text-white/30">{description.length}/5000</p>
                  {errors.description && <p className="text-xs text-red-400">{errors.description}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Tech Stack */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
          <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
            <CardHeader><CardTitle className="text-white">Tech Stack</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input value={techInput} onChange={(e) => setTechInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTechTag(); } }}
                  placeholder="Add a technology (press Enter)"
                  className="flex-1 border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50" />
                <Button type="button" variant="outline" onClick={addTechTag} className="border-white/10 bg-white/5 text-white/60 hover:bg-white/10">Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {techStack.map((tag) => (
                  <Badge key={tag} variant="secondary" className="cursor-pointer bg-indigo-500/10 font-mono text-indigo-300"
                    onClick={() => setTechStack(techStack.filter((t) => t !== tag))}>
                    {tag} ✕
                  </Badge>
                ))}
                {techStack.length === 0 && <p className="text-sm text-white/30">No tags yet. Add at least one.</p>}
              </div>
              <p className="text-xs text-white/30">{techStack.length}/10 tags</p>
              {errors.techStack && <p className="text-xs text-red-400">{errors.techStack}</p>}
            </CardContent>
          </Card>
        </motion.div>

        {/* Links + Media */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.25 }}>
          <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
            <CardHeader><CardTitle className="text-white">Links + Media</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="repoUrl" className="text-white/60">Repository URL</Label>
                <Input id="repoUrl" type="url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/user/repo"
                  className="mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50" />
                {errors.repoUrl && <p className="text-xs text-red-400">{errors.repoUrl}</p>}
              </div>
              <div>
                <Label htmlFor="liveUrl" className="text-white/60">Live URL</Label>
                <Input id="liveUrl" type="url" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} placeholder="https://example.com"
                  className="mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50" />
                {errors.liveUrl && <p className="text-xs text-red-400">{errors.liveUrl}</p>}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/60">Image / Video <span className="text-white/30">(required for Instagram/Threads, recommended for all)</span></Label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowMediaLibrary(!showMediaLibrary)} className="text-white/50 hover:text-white">
                    {showMediaLibrary ? 'Hide library' : 'Pick from library'}
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,video/mp4"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {showMediaLibrary && (
                  <div className="mt-2">
                    <MediaLibrary
                      onSelect={pickFromLibrary}
                      selectedUrl={imageUrl}
                      onUploadNew={() => fileInputRef.current?.click()}
                    />
                  </div>
                )}
                {imagePreview ? (
                  <div className="mt-2 relative">
                    <MediaPreview src={imagePreview} alt="Preview" className="max-h-48 rounded-lg border border-white/10" />
                    <button
                      type="button"
                      onClick={() => { setImageUrl(''); setImagePreview(''); }}
                      className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  !showMediaLibrary && (
                    <div
                      onClick={() => !uploading && fileInputRef.current?.click()}
                      onDrop={handleDrop}
                      onDragOver={(e) => e.preventDefault()}
                      className="mt-2 border-2 border-dashed border-white/10 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-500/50 transition-colors"
                    >
                      {uploading ? (
                        <p className="text-white/40">Uploading…</p>
                      ) : (
                        <>
                          <p className="text-white/40">Drag &amp; drop an image or video here</p>
                          <p className="text-white/20 text-sm mt-1">or click to browse — or pick from your Media Library</p>
                          <p className="text-white/20 text-xs mt-2">JPG, PNG, GIF, WebP, MP4 — max 50MB</p>
                        </>
                      )}
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <div className="flex gap-3">
          <Button type="submit" disabled={loading} className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 border-0">
            {loading ? (isEditMode ? 'Saving…' : 'Creating…') : (isEditMode ? 'Save Changes' : 'Create Post Card')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(-1)} className="border-white/10 bg-white/5 text-white/60 hover:bg-white/10">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
