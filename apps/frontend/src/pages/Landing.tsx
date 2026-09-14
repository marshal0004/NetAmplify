import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const platforms = ['Reddit', 'Discord', 'Dev.to', 'Telegram', 'Bluesky', 'Hashnode', 'X', 'LinkedIn'];

const features = [
  {
    icon: '🚀',
    title: 'One-Click Amplify',
    desc: 'Create a Post Card once. Click Amplify. NetAmplify formats and publishes to all your connected platforms simultaneously.',
    gradient: 'from-indigo-500 to-purple-500',
  },
  {
    icon: '🔐',
    title: 'OAuth 2.0 + PKCE',
    desc: 'We never see your passwords. You log in on each platform\'s own page. Tokens are encrypted with AES-256-GCM at rest.',
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    icon: '✨',
    title: 'Smart Format Engine',
    desc: 'Each platform gets perfectly formatted content — 280 chars for X, markdown for Dev.to, embeds for Discord, HTML for Telegram.',
    gradient: 'from-purple-500 to-pink-500',
  },
  {
    icon: '⚡',
    title: 'Real-Time Status',
    desc: 'Watch each platform go from QUEUED → PUBLISHING → SUCCESS in real-time. Partial success allowed — one failure never blocks others.',
    gradient: 'from-orange-500 to-red-500',
  },
  {
    icon: '🔄',
    title: 'Auto-Retry + Backoff',
    desc: 'Rate-limited? Network error? BullMQ auto-retries with exponential backoff. AUTH errors mark the connection REVOKED with a reconnect hint.',
    gradient: 'from-green-500 to-emerald-500',
  },
  {
    icon: '🛡️',
    title: 'Trust & Security Panel',
    desc: 'See exactly what scopes each platform has. Disconnect anytime. Account deletion cascades to all your data — GDPR-style wipe.',
    gradient: 'from-gray-600 to-gray-800',
  },
];

const testimonials = [
  { name: 'Priya S.', role: 'Final Year CS Student', text: 'I posted my project to 5 platforms in literally 10 seconds. Recruiters found me on LinkedIn the next day.', avatar: '👩‍💻' },
  { name: 'Rahul K.', role: 'Hackathon Winner', text: 'The Format Engine is genius — my markdown description automatically became a perfect tweet, a Reddit post, and a Discord embed.', avatar: '🧑‍💻' },
  { name: 'Sneha M.', role: 'Open Source Contributor', text: 'As a student, I couldn\'t afford Buffer\'s $30/month. NetAmplify is free, open-source, and honestly looks better.', avatar: '👩‍🔬' },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.15 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' as const } },
};

export function Landing() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const heroY = useTransform(scrollYProgress, [0, 0.3], [0, -100]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.3], [1, 0]);

  return (
    <div ref={containerRef} className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* Animated gradient background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-[#0a0a0f] to-purple-950" />
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px]" />
      </div>

      {/* Navigation */}
      <motion.nav
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="fixed top-0 z-50 w-full border-b border-white/5 bg-black/20 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-sm font-bold">N</div>
            <span className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">NetAmplify</span>
          </div>
          <div className="flex gap-3">
            <Link to="/login"><Button variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10">Log in</Button></Link>
            <Link to="/signup">
              <Button className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 border-0">
                Get started
              </Button>
            </Link>
          </div>
        </div>
      </motion.nav>

      {/* Hero Section */}
      <motion.section
        style={{ y: heroY, opacity: heroOpacity }}
        className="relative z-10 flex min-h-screen items-center justify-center px-6"
      >
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            <Badge className="mb-6 border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20">
              ✨ Open Source · OAuth 2.0 · AES-256-GCM
            </Badge>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-5xl md:text-7xl font-bold tracking-tight"
          >
            Post once.
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Get seen everywhere.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mx-auto mt-8 max-w-2xl text-lg md:text-xl text-white/60"
          >
            A student creates a Post Card once; NetAmplify formats it per-platform and
            publishes to Reddit, Discord, Dev.to, Telegram, Bluesky, and Hashnode
            using the user's own credentials. We never see your passwords.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="mt-10 flex justify-center gap-4"
          >
            <Link to="/signup">
              <Button size="lg" className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 border-0 text-base px-8">
                Get started — it's free
              </Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white text-base px-8">
                Log in
              </Button>
            </Link>
          </motion.div>

          {/* Floating platform icons */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.8 }}
            className="mt-16 flex flex-wrap justify-center gap-3"
          >
            {platforms.map((p, i) => (
              <motion.div
                key={p}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.8 + i * 0.1 }}
                whileHover={{ scale: 1.1, y: -5 }}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 backdrop-blur-sm transition-colors hover:border-indigo-500/50 hover:bg-indigo-500/10"
              >
                {p}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* Features Section */}
      <motion.section
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-100px' }}
        className="relative z-10 mx-auto max-w-6xl px-6 py-32"
      >
        <motion.div variants={itemVariants} className="mb-16 text-center">
          <h2 className="text-4xl md:text-5xl font-bold">
            Built for <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">students</span>
          </h2>
          <p className="mt-4 text-lg text-white/50">Everything you need to showcase your work across the developer ecosystem.</p>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <motion.div key={f.title} variants={itemVariants} whileHover={{ y: -8 }}>
              <Card className="group relative overflow-hidden border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all hover:border-white/20">
                <div className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 transition-opacity duration-500 group-hover:opacity-10`} />
                <CardContent className="relative pt-6">
                  <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${f.gradient} text-2xl shadow-lg`}>
                    {f.icon}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-white">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-white/50">{f.desc}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* How It Works Section */}
      <motion.section
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-100px' }}
        className="relative z-10 mx-auto max-w-4xl px-6 py-32"
      >
        <motion.h2 variants={itemVariants} className="mb-16 text-center text-4xl md:text-5xl font-bold">
          How it <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">works</span>
        </motion.h2>

        <div className="space-y-8">
          {[
            { step: '01', title: 'Create a Post Card', desc: 'Write your project title, summary, markdown description, and tech stack once. No copy-pasting between platforms.' },
            { step: '02', title: 'Connect platforms', desc: 'OAuth login (Reddit, X, LinkedIn) or paste a key (Dev.to, Discord, Telegram, Bluesky). Encrypted with AES-256-GCM.' },
            { step: '03', title: 'Amplify', desc: 'One click publishes to all connected platforms with per-platform formatting. Watch real-time status updates.' },
          ].map((s) => (
            <motion.div key={s.step} variants={itemVariants} className="flex items-start gap-6">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 text-lg font-bold shadow-lg shadow-indigo-500/30">
                {s.step}
              </div>
              <div className="flex-1 border-l border-white/10 pl-6 pb-8">
                <h3 className="mb-2 text-xl font-semibold text-white">{s.title}</h3>
                <p className="text-white/50">{s.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Testimonials Section */}
      <motion.section
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-100px' }}
        className="relative z-10 mx-auto max-w-6xl px-6 py-32"
      >
        <motion.h2 variants={itemVariants} className="mb-16 text-center text-4xl md:text-5xl font-bold">
          Loved by <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">students</span>
        </motion.h2>

        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <motion.div key={t.name} variants={itemVariants} whileHover={{ y: -5 }}>
              <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
                <CardContent className="pt-6">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-2xl">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="font-semibold text-white">{t.name}</p>
                      <p className="text-xs text-white/40">{t.role}</p>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed text-white/60">"{t.text}"</p>
                  <div className="mt-4 flex gap-1 text-yellow-400">★★★★★</div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* CTA Section */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="relative z-10 mx-auto max-w-4xl px-6 py-32 text-center"
      >
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 p-12 backdrop-blur-xl">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-indigo-500/20 rounded-full blur-[80px]" />
          <h2 className="relative text-3xl md:text-4xl font-bold">
            Ready to get seen?
          </h2>
          <p className="relative mt-4 text-white/50">
            Join students who are amplifying their projects across the developer ecosystem.
          </p>
          <Link to="/signup">
            <Button size="lg" className="relative mt-8 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 border-0 text-base px-10">
              Start amplifying — free
            </Button>
          </Link>
        </div>
      </motion.section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-sm font-bold">N</div>
              <span className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">NetAmplify</span>
            </div>
            <div className="flex gap-6 text-sm text-white/40">
              <a href="https://github.com/marshal0004/NetAmplify" target="_blank" rel="noreferrer" className="hover:text-white/80 transition-colors">GitHub</a>
              <span>Post once. Get seen everywhere.</span>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-white/20">
            © 2026 NetAmplify. Open source. Built with TypeScript, NestJS, React, and Prisma.
          </p>
        </div>
      </footer>
    </div>
  );
}
