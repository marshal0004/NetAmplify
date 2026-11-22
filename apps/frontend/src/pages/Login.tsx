import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function Login() {
 const { login } = useAuth();
 const navigate = useNavigate();
 const location = useLocation();
 const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [error, setError] = useState<string | null>(null);
 const [loading, setLoading] = useState(false);

 async function handleSubmit(e: React.FormEvent) {
 e.preventDefault();
 setError(null);
 setLoading(true);
 try {
 await login(email, password);
 navigate(from, { replace: true });
 } catch (err) {
 setError(getErrorMessage(err));
 } finally {
 setLoading(false);
 }
 }

 return (
 <div className="relative flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
 <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
 <div className="absolute top-1/4 left-1/4 h-[400px] w-[400px] rounded-full bg-primary/10 blur-[120px]" />
 <div className="absolute bottom-1/4 right-1/4 h-[400px] w-[400px] rounded-full bg-primary/5 blur-[120px]" />
 </div>

 <motion.div
 initial={{ opacity: 0, y: 24 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.4 }}
 className="relative z-10 w-full max-w-md"
 >
 <Card className="border-border shadow-2xl">
 <CardHeader>
 <div className="mb-2 flex items-center gap-2.5">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">N</div>
 <span className="text-lg font-bold text-foreground">NetAmplify</span>
 </div>
 <CardTitle className="text-foreground">Log in</CardTitle>
 </CardHeader>
 <CardContent>
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-2">
 <Label htmlFor="email" className="text-foreground">Email</Label>
 <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" />
 </div>
 <div className="space-y-2">
 <Label htmlFor="password" className="text-foreground">Password</Label>
 <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
 </div>
 {error && <p className="text-sm text-destructive">{error}</p>}
 <Button type="submit" disabled={loading} className="w-full">
 {loading ? 'Logging in…' : 'Log in'}
 </Button>
 </form>
 <div className="mt-4 flex justify-between text-sm">
 <Link to="/signup" className="text-muted-foreground transition-colors hover:text-foreground">Need an account?</Link>
 <Link to="/reset" className="text-muted-foreground transition-colors hover:text-foreground">Forgot password?</Link>
 </div>
 </CardContent>
 </Card>
 </motion.div>
 </div>
 );
}
