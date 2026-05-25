'use client';
import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ret = params.get('return') ?? '/dashboard';
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
    <div className="panel" style={{ width: 380, padding: 0 }}>
      <div style={{ padding: '28px 28px 8px' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Create account</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>Start with a 7-day mobile-proxy plan in under 2 minutes.</div>
      </div>
      <form onSubmit={onSubmit} style={{ padding: '8px 28px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">Full name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} required minLength={2} />
        </div>
        <div>
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="form-label">Password (min 8)</label>
          <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create account'}
        </button>
        <div style={{ marginTop: 8, fontSize: 12.5, textAlign: 'center' }}>
          <Link href={`/login?return=${encodeURIComponent(ret)}`} style={{ color: 'var(--muted)' }}>
            Have an account? <span style={{ color: 'var(--accent-text)' }}>Sign in</span>
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="panel" style={{ padding: 28 }}>Loading…</div>}>
      <RegisterForm />
    </Suspense>
  );
}
