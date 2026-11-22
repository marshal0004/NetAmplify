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
 <div className="relative flex min-h-screen items-center justify-center bg-background text-foreground">
 <div className="fixed inset-0 z-0">
 <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-primary/10 rounded-full blur-[120px]" />
 <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[120px]" />
 </div>

 <motion.div
 initial={{ opacity: 0, y: 30 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.5 }}
 className="relative z-10 w-full max-w-md"
 >
 <Card className="shadow-sm">
 <CardHeader>
 <div className="mb-2 flex items-center gap-2">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold">N</div>
 <span className="text-lg font-bold text-foreground">NetAmplify</span>
 </div>
 <CardTitle className="text-foreground">Reset your password</CardTitle>
 </CardHeader>
 <CardContent>
 {sent ? (
 <div className="space-y-4">
 <p className="text-sm text-foreground">
 If an account exists for <strong className="text-white">{email}</strong>, a reset link has been sent.
 Check your email and click the link to set a new password.
 </p>
 <p className="text-xs text-muted-foreground">In development, the reset link is also printed to the server console.</p>
 </div>
 ) : (
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-2">
 <Label htmlFor="email" className="text-foreground">Email</Label>
 <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com"
 className="" />
 </div>
 <Button type="submit" disabled={loading} className="w-full">
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
