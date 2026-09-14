import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setLoading(true);
    try {
      const card = await postcardApi.create({
        title, summary, description, techStack,
        repoUrl: repoUrl || undefined, liveUrl: liveUrl || undefined,
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
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-3xl font-bold text-white"
      >
        New Post Card
      </motion.h1>

      {formError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{formError}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
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
                  <div className="whitespace-pre-wrap">{description}</div>
                </div>
              ) : (
                <div>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={5000} rows={12}
                    placeholder="## Introduction&#10;&#10;Describe your project here. Markdown supported."
                    className="font-mono text-sm border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50" />
                  <p className="mt-1 text-xs text-white/30">{description.length}/5000</p>
                  {errors.description && <p className="text-xs text-red-400">{errors.description}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

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

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.25 }}>
          <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
            <CardHeader><CardTitle className="text-white">Links (optional)</CardTitle></CardHeader>
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
            </CardContent>
          </Card>
        </motion.div>

        <div className="flex gap-3">
          <Button type="submit" disabled={loading} className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 border-0">
            {loading ? 'Creating…' : 'Create Post Card'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/dashboard')} className="border-white/10 bg-white/5 text-white/60 hover:bg-white/10">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
