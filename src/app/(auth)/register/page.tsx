'use client';
import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ret = params.get('return') ?? '/dashboard';
  const fromSite = params.get('from') === 'site';
  const loginHref = `/login?return=${encodeURIComponent(ret)}${fromSite ? '&from=site' : ''}`;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? 'Registration failed');
      setLoading(false);
      return;
    }
    const res = await signIn('credentials', { redirect: false, email, password });
    setLoading(false);
    if (res?.error) {
      setErr('Account created but sign-in failed');
      return;
    }
    router.push(ret);
    router.refresh();
  }

  return (
    <div className="auth-card">
      <div className="auth-title">Create account</div>
      <form className="auth-form" onSubmit={onSubmit}>
        <div className="form-row">
          <label className="form-label">Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} required minLength={2} />
        </div>
        <div className="form-row">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div className="form-row">
          <label className="form-label">Password</label>
          <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
        </div>
        {err && <div className="form-help error">{err}</div>}
        <button className="btn primary lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: 24 }}>
          {loading ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <div className="auth-links">
        <Link href={loginHref}>Have an account? Sign in</Link>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="auth-card">Loading…</div>}>
      <RegisterForm />
    </Suspense>
  );
}
