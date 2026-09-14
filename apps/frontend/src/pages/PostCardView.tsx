import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { postcardApi } from '@/lib/api';
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

  if (isLoading) return <div className="text-white/50">Loading…</div>;
  if (!card) return <div className="text-white/50">PostCard not found</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-between"
      >
        <Link to="/dashboard">
          <Button variant="ghost" size="sm" className="text-white/50 hover:text-white">← Back to dashboard</Button>
        </Link>
        <Link to={`/dashboard/postcards/${card.id}/publish`}>
          <Button className="bg-gradient-to-r from-indigo-500 to-purple-500 border-0">🚀 Amplify</Button>
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
          <CardContent className="pt-6">
            <h1 className="mb-2 text-2xl font-bold text-white">{card.title}</h1>
            <p className="mb-6 text-white/50">{card.summary}</p>
            <div className="flex flex-wrap gap-2">
              {card.techStack.map((tag) => (
                <Badge key={tag} variant="secondary" className="bg-indigo-500/10 font-mono text-indigo-300">{tag}</Badge>
              ))}
            </div>
            {(card.repoUrl || card.liveUrl) && (
              <div className="mt-6 flex gap-4 text-sm">
                {card.repoUrl && <a href={card.repoUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">📦 Repo</a>}
                {card.liveUrl && <a href={card.liveUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">🌐 Live</a>}
              </div>
            )}
            <div className="mt-8 border-t border-white/5 pt-6">
              <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-white/70">{card.description}</div>
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
        <Link to={`/dashboard/postcards/${card.id}/publish`}>
          <Button className="bg-gradient-to-r from-indigo-500 to-purple-500 border-0">🚀 Amplify to platforms</Button>
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
