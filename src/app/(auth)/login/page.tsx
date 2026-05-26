'use client';
import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ret = params.get('return') ?? '/';
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
    <div className="panel" style={{ width: 380, padding: 0 }}>
      <div style={{ padding: '28px 28px 8px' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Sign in</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>Connect · Route · Unlock</div>
      </div>
      <form onSubmit={onSubmit} style={{ padding: '8px 28px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="form-label">Password</label>
          <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
        <button className="btn primary" type="submit" disabled={loading} style={{ marginTop: 4 }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12.5 }}>
          <Link href="/forgot" style={{ color: 'var(--muted)' }}>Forgot password?</Link>
          <Link href={`/register?return=${encodeURIComponent(ret)}`} style={{ color: 'var(--accent-text)' }}>Create account</Link>
        </div>
        <div style={{ marginTop: 12, padding: 10, background: 'var(--surface-2)', borderRadius: 8, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          <div><strong style={{ color: 'var(--text)' }}>Admin operators:</strong></div>
          <div>· admin@hbp.local · admin1234 (super)</div>
          <div>· ops@hbp.local · admin1234 (operations)</div>
          <div>· support@hbp.local · admin1234 (support)</div>
          <div style={{ marginTop: 6, color: 'var(--text-disabled)' }}>Clients: use <Link href="/register" style={{ color: 'var(--accent-text)' }}>Create account</Link> or buy from <Link href="/marketing" style={{ color: 'var(--accent-text)' }}>marketing</Link>.</div>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="panel" style={{ padding: 28 }}>Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
