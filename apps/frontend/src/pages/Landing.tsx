// /home/z/my-project/netamplify-app/apps/frontend/src/pages/Landing.tsx
// NetAmplify — Landing page (public).
// Per docs/06-FRONTEND-SPEC.md Screen 1: hero, how-it-works, platform logos, security blurb, CTA.

import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-indigo-600">NetAmplify</span>
        </div>
        <div className="flex gap-3">
          <Link to="/login"><Button variant="ghost">Log in</Button></Link>
          <Link to="/signup"><Button>Get started</Button></Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900">
          Post once. Get seen everywhere.
        </h1>
        <p className="mt-6 text-xl text-gray-600">
          A student creates a Post Card once; NetAmplify formats it per-platform
          and publishes it to Reddit, Discord, Dev.to, Telegram, Bluesky, and
          Hashnode using the user's own credentials.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link to="/signup"><Button size="lg">Get started — it's free</Button></Link>
          <Link to="/login"><Button size="lg" variant="outline">Log in</Button></Link>
        </div>

        <div className="mt-20 grid gap-8 md:grid-cols-3">
          {[
            { step: '1', title: 'Create a Post Card', desc: 'Write your project title, summary, description, and tech stack once.' },
            { step: '2', title: 'Connect platforms', desc: 'OAuth login (Reddit, X, LinkedIn) or paste a key (Dev.to, Discord, Telegram, Bluesky).' },
            { step: '3', title: 'Amplify', desc: 'One click publishes to all connected platforms with per-platform formatting.' },
          ].map((s) => (
            <Card key={s.step}>
              <CardContent className="pt-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-600">
                  {s.step}
                </div>
                <h3 className="mb-2 font-semibold">{s.title}</h3>
                <p className="text-sm text-gray-600">{s.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-20 rounded-xl bg-white p-8 shadow-sm">
          <h2 className="mb-4 text-2xl font-semibold">We never see your passwords</h2>
          <p className="text-gray-600">
            We use OAuth 2.0 with PKCE — you log in on each platform's own page.
            We only get a limited permission to post, and you can revoke it anytime
            from your platform settings. Your credentials are encrypted with
            AES-256-GCM at rest; even a database breach can't expose usable tokens.
          </p>
        </div>

        <div className="mt-16 flex flex-wrap justify-center gap-4 text-gray-400">
          {['Reddit', 'Discord', 'Dev.to', 'Telegram', 'Bluesky', 'Hashnode', 'X', 'LinkedIn'].map((p) => (
            <span key={p} className="rounded-lg border bg-white px-4 py-2 text-sm font-medium">{p}</span>
          ))}
        </div>
      </main>
    </div>
  );
}
