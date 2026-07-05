'use client';
import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function ForgotForm() {
  const params = useSearchParams();
  const loginHref = `/login${params.get('from') === 'site' ? '?from=site' : ''}`;

  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j.error ?? `Request failed (HTTP ${r.status}).`);
      setSent(true);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="auth-card">
        <div className="auth-title">Check your inbox</div>
        <div className="auth-subtitle" style={{ marginTop: 8 }}>
          If <strong>{email}</strong> is registered, a password reset link is on its way.
          The link expires in 60 minutes — check spam if it doesn&rsquo;t arrive.
        </div>
        <div className="auth-links" style={{ justifyContent: 'center' }}>
          <Link href={loginHref}>Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <div className="auth-title">Forgot password?</div>
      <div className="auth-subtitle" style={{ marginTop: 8 }}>
        Enter the email you registered with and we&rsquo;ll send you a link to set a new password.
      </div>
      <form className="auth-form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <div className="form-row">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </div>
        {err && (
          <div className="form-help error">
            {err}{' '}
            <a href="https://t.me/US5Gwetrust" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
              Contact support
            </a>
          </div>
        )}
        <button className="btn primary lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: 24 }}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <div className="auth-links" style={{ justifyContent: 'center' }}>
        <Link href={loginHref}>Back to sign in</Link>
      </div>
    </div>
  );
}

export default function ForgotPage() {
  return (
    <Suspense fallback={<div className="auth-card">Loading…</div>}>
      <ForgotForm />
    </Suspense>
  );
}
