// /home/z/my-project/netamplify-app/apps/frontend/src/pages/PostCardView.tsx
// NetAmplify — View/edit a PostCard + "Amplify" button.

import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
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

  if (isLoading) return <div>Loading…</div>;
  if (!card) return <div>PostCard not found</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/dashboard">
          <Button variant="ghost" size="sm">← Back to dashboard</Button>
        </Link>
        <Link to={`/dashboard/postcards/${card.id}/publish`}>
          <Button>🚀 Amplify</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h1 className="mb-2 text-2xl font-bold">{card.title}</h1>
          <p className="mb-6 text-gray-600">{card.summary}</p>
          <div className="flex flex-wrap gap-2">
            {card.techStack.map((tag) => (
              <Badge key={tag} variant="secondary" className="font-mono">{tag}</Badge>
            ))}
          </div>
          {(card.repoUrl || card.liveUrl) && (
            <div className="mt-6 flex gap-4 text-sm">
              {card.repoUrl && (
                <a href={card.repoUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                  📦 Repo
                </a>
              )}
              {card.liveUrl && (
                <a href={card.liveUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                  🌐 Live
                </a>
              )}
            </div>
          )}
          <div className="mt-8 border-t pt-6">
            <div className="prose prose-sm max-w-none whitespace-pre-wrap">
              {card.description}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Link to={`/dashboard/postcards/${card.id}/publish`}>
          <Button>🚀 Amplify to platforms</Button>
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
      </div>
    </div>
  );
}
