import { useState } from 'react';
import { motion } from 'framer-motion';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ResetRequest() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.resetRequest(email);
    } catch { /* Ignore — always returns 204 */ } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0a0f] text-white">
      <div className="fixed inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-indigo-600/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-purple-600/20 rounded-full blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="ring-1 ring-zinc-200 bg-white shadow-sm">
          <CardHeader>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br bg-orange-600 text-sm font-bold">N</div>
              <span className="text-lg font-bold bg-gradient-to-r text-orange-500 bg-clip-text text-transparent">NetAmplify</span>
            </div>
            <CardTitle className="text-white">Reset your password</CardTitle>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-4">
                <p className="text-sm text-zinc-600">
                  If an account exists for <strong className="text-white">{email}</strong>, a reset link has been sent.
                  Check your email and click the link to set a new password.
                </p>
                <p className="text-xs text-zinc-400">In development, the reset link is also printed to the server console.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-zinc-600">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com"
                    className="ring-1 ring-zinc-200 text-zinc-50 text-zinc-900 placeholder:text-zinc-300 focus:ring-2 focus:ring-orange-500" />
                </div>
                <Button type="submit" disabled={loading} className="w-full bg-gradient-to-r bg-orange-600 hover:bg-orange-700 border-0">
                  {loading ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
