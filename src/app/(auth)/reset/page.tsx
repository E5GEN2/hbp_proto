'use client';
import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="auth-card">
        <div className="auth-title">Invalid reset link</div>
        <div className="auth-subtitle" style={{ marginTop: 8 }}>
          This link is missing its token. Open the link from your email again, or request a new one.
        </div>
        <Link className="btn primary lg" href="/forgot"
          style={{ width: '100%', marginTop: 24, display: 'flex', justifyContent: 'center' }}>
          Request new link
        </Link>
        <div className="auth-links" style={{ justifyContent: 'center' }}>
          <Link href="/login">Back to sign in</Link>
        </div>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr('Passwords don’t match');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j.error ?? `Reset failed (HTTP ${r.status}).`);
      router.push('/login?reset=1');
    } catch (e: any) {
      setErr(e.message);
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-title">Set a new password</div>
      <form className="auth-form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <div className="form-row">
          <label className="form-label">New password</label>
          <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)}
            minLength={8} required autoFocus autoComplete="new-password" />
        </div>
        <div className="form-row">
          <label className="form-label">Repeat new password</label>
          <input className="form-input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            minLength={8} required autoComplete="new-password" />
        </div>
        {err && <div className="form-help error">{err}</div>}
        <button className="btn primary lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: 24 }}>
          {loading ? 'Saving…' : 'Save new password'}
        </button>
      </form>
      <div className="auth-links" style={{ justifyContent: 'center' }}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="auth-card">Loading…</div>}>
      <ResetForm />
    </Suspense>
  );
}
