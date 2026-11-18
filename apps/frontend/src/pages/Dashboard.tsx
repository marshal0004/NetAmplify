import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { postcardApi, connectionsApi, type PostCard } from '@/lib/api';
import { MediaPreview } from '@/components/MediaPreview';
import { EditPostCardDialog } from '@/components/EditPostCardDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function Dashboard() {
  const { data: postcards } = useQuery({
    queryKey: ['postcards', 1],
    queryFn: () => postcardApi.list(1, 12),
  });
  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => connectionsApi.list(),
  });

  // Inline-edit state: which PostCard is currently open in the EditPostCardDialog.
  // null = no dialog open. The dialog does the PATCH + invalidates the postcards
  // query on save, so the grid re-renders with the updated card.
  const [editingCard, setEditingCard] = useState<PostCard | null>(null);

  const connectedCount = connections?.filter((c) => c.platformUsername !== null).length ?? 0;
  const hasPostCards = (postcards?.total ?? 0) > 0;

  const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } };
  const item = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } };

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-between"
      >
        <h1 className="text-3xl font-bold text-white">Your Post Cards</h1>
        <Link to="/dashboard/postcards/new">
          <Button className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 border-0">+ New Post Card</Button>
        </Link>
      </motion.div>

      {/* Onboarding strip */}
      {!hasPostCards || connectedCount === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="border-indigo-500/20 bg-indigo-500/5 backdrop-blur-xl">
            <CardContent className="pt-6">
              <h2 className="mb-4 font-semibold text-indigo-300">Get started in 3 steps</h2>
              <div className="flex gap-6">
                <OnboardingStep step="1" label="Create profile" done={true} link="/dashboard/settings" />
                <OnboardingStep step="2" label={`Connect platforms (${connectedCount}/8)`} done={connectedCount >= 1} link="/dashboard/connections" />
                <OnboardingStep step="3" label="Amplify your first project" done={hasPostCards} link="/dashboard/postcards/new" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ) : null}

      {/* Stats */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-3 gap-4"
      >
        {[
          { label: 'Post Cards', value: postcards?.total ?? 0 },
          { label: 'Connected platforms', value: connectedCount },
          { label: 'Total publishes', value: '—' },
        ].map((s) => (
          <motion.div key={s.label} variants={item}>
            <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
              <CardContent className="pt-6">
                <p className="text-sm text-white/40">{s.label}</p>
                <p className="text-2xl font-bold text-white">{s.value}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* PostCard grid — 2 cards per row on tablet/desktop, 1 per row on mobile. */}
      {hasPostCards ? (
        <motion.div
          variants={container}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          {postcards?.items.map((card) => (
            <motion.div key={card.id} variants={item} whileHover={{ y: -5 }} className="relative">
              <Link to={`/dashboard/postcards/${card.id}`}>
                <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all hover:border-white/20 hover:bg-white/[0.05]">
                  <CardContent className="pt-6">
                    {card.imageUrl && (
                      <div className="mb-3 overflow-hidden rounded-lg border border-white/10">
                        <MediaPreview src={card.imageUrl} alt={card.title} className="max-h-40 w-full object-cover" controls={false} />
                      </div>
                    )}
                    <h3 className="mb-2 font-semibold text-white">{card.title}</h3>
                    <p className="mb-4 text-sm text-white/50">{card.summary}</p>
                    <div className="flex flex-wrap gap-1">
                      {card.techStack.map((tag) => (
                        <Badge key={tag} variant="secondary" className="bg-indigo-500/10 font-mono text-xs text-indigo-300">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    {card.repoUrl && (
                      <p className="mt-4 truncate text-xs text-indigo-400/60">{card.repoUrl}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
              {/* Inline Edit button — sibling of the Link (NOT nested inside the
                  <a>, which would be invalid HTML + would trigger navigation).
                  Opens EditPostCardDialog → PATCH /api/postcards/:id → the
                  postcards query is invalidated inside the dialog, so the grid
                  re-renders with the updated card. This is the "edit + save in
                  live preview" affordance that was missing. */}
              <button
                onClick={() => setEditingCard(card)}
                className="absolute right-3 top-3 z-10 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/60 backdrop-blur-sm transition-colors hover:bg-white/10 hover:text-white"
                aria-label={`Edit ${card.title}`}
              >
                ✏️ Edit
              </button>
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="border-dashed border-white/10 bg-white/[0.02]">
            <CardContent className="pt-6 text-center">
              <p className="text-lg text-white/40">No post cards yet</p>
              <p className="mb-4 text-sm text-white/30">Create your first post card to start amplifying.</p>
              <Link to="/dashboard/postcards/new">
                <Button className="bg-gradient-to-r from-indigo-500 to-purple-500 border-0">+ Create your first Post Card</Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Inline edit dialog — rendered when a card's Edit button is clicked.
          The dialog handles the PATCH + query invalidation; onClose just clears
          the editingCard state. */}
      {editingCard && (
        <EditPostCardDialog
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onSaved={() => {
            /* postcards query invalidated inside the dialog; grid re-renders. */
          }}
        />
      )}
    </div>
  );
}

function OnboardingStep({ step, label, done, link }: { step: string; label: string; done: boolean; link: string }) {
  return (
    <Link to={link} className="flex flex-col items-center gap-2">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, delay: 0.3 }}
        className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
          done ? 'bg-green-500/20 text-green-400' : 'border border-white/20 text-white/40'
        }`}
      >
        {done ? '✓' : step}
      </motion.div>
      <span className={`text-sm ${done ? 'text-white/50' : 'text-white/90'}`}>{label}</span>
    </Link>
  );
}
