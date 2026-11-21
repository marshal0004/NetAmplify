import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { postcardApi } from '@/lib/api';
import { MediaPreview } from '@/components/MediaPreview';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function PostCardView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: card, isLoading } = useQuery({
    queryKey: ['postcard', id],
    queryFn: () => postcardApi.get(id!),
    enabled: !!id,
  });

  if (isLoading) return <div className="text-zinc-500">Loading…</div>;
  if (!card) return <div className="text-zinc-500">PostCard not found</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-between"
      >
        <Link to="/dashboard">
          <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-900">← Back to dashboard</Button>
        </Link>
        <Link to={`/dashboard/postcards/${card.id}/publish`}>
          <Button className="bg-gradient-to-r bg-orange-600 border-0">🚀 Amplify</Button>
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card className="ring-1 ring-zinc-200 bg-white shadow-sm">
          <CardContent className="pt-6">
            <h1 className="mb-2 text-2xl font-bold text-white">{card.title}</h1>
            <p className="mb-6 text-zinc-500">{card.summary}</p>
            <div className="flex flex-wrap gap-2">
              {card.techStack.map((tag) => (
                <Badge key={tag} variant="secondary" className="bg-orange-50 font-mono text-orange-600">{tag}</Badge>
              ))}
            </div>
            {(card.repoUrl || card.liveUrl) && (
              <div className="mt-6 flex gap-4 text-sm">
                {card.repoUrl && <a href={card.repoUrl} target="_blank" rel="noreferrer" className="text-orange-500 hover:underline">📦 Repo</a>}
                {card.liveUrl && <a href={card.liveUrl} target="_blank" rel="noreferrer" className="text-orange-500 hover:underline">🌐 Live</a>}
              </div>
            )}
            {card.imageUrl && (
              <div className="mt-6">
                <MediaPreview src={card.imageUrl} alt={card.title} className="max-w-full rounded-lg border ring-1 ring-zinc-200" />
              </div>
            )}
            <div className="mt-8 border-t ring-1 ring-zinc-100 pt-6">
              <div className="prose prose-sm prose-invert max-w-none text-zinc-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.description}</ReactMarkdown>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="flex gap-3"
      >
        <Link to={`/dashboard/postcards/${card.id}/edit`}>
          <Button variant="outline" className="ring-1 ring-zinc-200 text-zinc-50 text-zinc-600 hover:text-zinc-100">✏️ Edit</Button>
        </Link>
        <Link to={`/dashboard/postcards/${card.id}/publish`}>
          <Button className="bg-gradient-to-r bg-orange-600 border-0">🚀 Amplify to platforms</Button>
        </Link>
        <Button
          variant="destructive"
          onClick={async () => {
            if (confirm('Delete this PostCard? This cannot be undone.')) {
              await postcardApi.delete(card.id);
              navigate('/dashboard');
            }
          }}
        >
          Delete
        </Button>
      </motion.div>
    </div>
  );
}
