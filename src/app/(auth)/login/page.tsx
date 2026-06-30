'use client';
import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ret = params.get('return') ?? '/';
  const fromSite = params.get('from') === 'site';
  const carry = fromSite ? '&from=site' : '';
  const registerHref = `/register?return=${encodeURIComponent(ret)}${carry}`;
  const forgotHref = `/forgot${fromSite ? '?from=site' : ''}`;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const res = await signIn('credentials', { redirect: false, email, password });
    setLoading(false);
    if (res?.error) {
      setErr('Sign-in failed. Check your credentials.');
      return;
    }
    router.push(ret);
    router.refresh();
  }

  return (
    <div className="auth-card">
      <div className="auth-title">Sign in</div>
      <form className="auth-form" onSubmit={onSubmit}>
        <div className="form-row">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div className="form-row">
          <label className="form-label">Password</label>
          <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        {err && <div className="form-help error">{err}</div>}
        <button className="btn primary lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="auth-links">
        <Link href={forgotHref}>Forgot password?</Link>
        <Link href={registerHref}>Create account</Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-card">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
