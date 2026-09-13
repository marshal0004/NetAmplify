// /home/z/my-project/netamplify-app/apps/frontend/src/pages/PostCardComposer.tsx
// NetAmplify — PostCard composer (create new).
// Per docs/06-FRONTEND-SPEC.md Screen 5: sections Basics / Story (markdown) /
// Tech tags (chips input) / Links. Preview toggle shows rendered markdown.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postcardApi } from '@/lib/api';
import { getErrorMessage, getFieldErrors } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function PostCardComposer() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [techStack, setTechStack] = useState<string[]>([]);
  const [techInput, setTechInput] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function addTechTag() {
    const tag = techInput.trim().toLowerCase();
    if (tag && !techStack.includes(tag) && techStack.length < 10) {
      setTechStack([...techStack, tag]);
      setTechInput('');
    }
  }

  function removeTechTag(tag: string) {
    setTechStack(techStack.filter((t) => t !== tag));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setLoading(true);
    try {
      const card = await postcardApi.create({
        title,
        summary,
        description,
        techStack,
        repoUrl: repoUrl || undefined,
        liveUrl: liveUrl || undefined,
      });
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
      <h1 className="text-2xl font-bold">New Post Card</h1>

      {formError && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{formError}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basics */}
        <Card>
          <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="title">Title <span className="text-red-500">*</span></Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
                placeholder="My Awesome Project"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-gray-500">{title.length}/120</p>
              {errors.title && <p className="text-xs text-red-600">{errors.title}</p>}
            </div>
            <div>
              <Label htmlFor="summary">Summary <span className="text-red-500">*</span></Label>
              <Input
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                required
                maxLength={200}
                placeholder="A one-line summary"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-gray-500">{summary.length}/200</p>
              {errors.summary && <p className="text-xs text-red-600">{errors.summary}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Story (markdown) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Story (Markdown)</CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? 'Edit' : 'Preview'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showPreview ? (
              <div className="prose prose-sm max-w-none rounded-md border bg-white p-4">
                <h1>{title}</h1>
                <p><em>{summary}</em></p>
                <div className="whitespace-pre-wrap">{description}</div>
              </div>
            ) : (
              <div>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  maxLength={5000}
                  rows={12}
                  placeholder="## Introduction&#10;&#10;Describe your project here. Markdown supported."
                  className="font-mono text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">{description.length}/5000</p>
                {errors.description && <p className="text-xs text-red-600">{errors.description}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tech tags */}
        <Card>
          <CardHeader><CardTitle>Tech Stack</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
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
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={addTechTag}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {techStack.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="cursor-pointer font-mono"
                  onClick={() => removeTechTag(tag)}
                >
                  {tag} ✕
                </Badge>
              ))}
              {techStack.length === 0 && (
                <p className="text-sm text-gray-400">No tags yet. Add at least one.</p>
              )}
            </div>
            <p className="text-xs text-gray-500">{techStack.length}/10 tags</p>
            {errors.techStack && <p className="text-xs text-red-600">{errors.techStack}</p>}
          </CardContent>
        </Card>

        {/* Links */}
        <Card>
          <CardHeader><CardTitle>Links (optional)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="repoUrl">Repository URL</Label>
              <Input
                id="repoUrl"
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/user/repo"
                className="mt-1"
              />
              {errors.repoUrl && <p className="text-xs text-red-600">{errors.repoUrl}</p>}
            </div>
            <div>
              <Label htmlFor="liveUrl">Live URL</Label>
              <Input
                id="liveUrl"
                type="url"
                value={liveUrl}
                onChange={(e) => setLiveUrl(e.target.value)}
                placeholder="https://example.com"
                className="mt-1"
              />
              {errors.liveUrl && <p className="text-xs text-red-600">{errors.liveUrl}</p>}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create Post Card'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/dashboard')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
