import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/auth';
import { getErrorMessage, getFieldErrors } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function Signup() {
 const { signup } = useAuth();
 const navigate = useNavigate();
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [name, setName] = useState('');
 const [errors, setErrors] = useState<Record<string, string>>({});
 const [formError, setFormError] = useState<string | null>(null);
 const [loading, setLoading] = useState(false);

 async function handleSubmit(e: React.FormEvent) {
 e.preventDefault();
 setErrors({});
 setFormError(null);
 setLoading(true);
 try {
 await signup(email, password, name);
 navigate('/dashboard', { replace: true });
 } catch (err) {
 setErrors(getFieldErrors(err));
 setFormError(getErrorMessage(err));
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
 <CardTitle className="text-foreground">Create your account</CardTitle>
 </CardHeader>
 <CardContent>
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-2">
 <Label htmlFor="name" className="text-foreground">Name</Label>
 <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Jane Doe" autoComplete="name" />
 {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
 </div>
 <div className="space-y-2">
 <Label htmlFor="email" className="text-foreground">Email</Label>
 <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" />
 {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
 </div>
 <div className="space-y-2">
 <Label htmlFor="password" className="text-foreground">Password</Label>
 <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
 <p className="text-xs text-muted-foreground">Min 8 chars, with at least one uppercase, one lowercase, and one digit.</p>
 {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
 </div>
 {formError && <p className="text-sm text-destructive">{formError}</p>}
 <Button type="submit" disabled={loading} className="w-full">
 {loading ? 'Creating account…' : 'Sign up'}
 </Button>
 </form>
 <p className="mt-4 text-center text-sm text-muted-foreground">
 Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Log in</Link>
 </p>
 </CardContent>
 </Card>
 </motion.div>
 </div>
 );
}
