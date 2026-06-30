'use client';
import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function ForgotForm() {
  const params = useSearchParams();
  const loginHref = `/login${params.get('from') === 'site' ? '?from=site' : ''}`;
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <div className="auth-card">
      <div className="auth-title">Forgot password?</div>
      <div className="auth-subtitle">Enter your email — we&rsquo;ll send a recovery code.</div>
      {!sent ? (
        <>
          <form className="auth-form" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
            <div className="form-row">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="auth-divider" />
            <button className="btn primary lg" type="submit" style={{ width: '100%', marginTop: 4 }}>Send code</button>
          </form>
          <div className="auth-links" style={{ justifyContent: 'center' }}>
            <Link href={loginHref}>Back to sign in</Link>
          </div>
        </>
      ) : (
        <>
          <div className="form-help" style={{ padding: 12, background: 'var(--success-dim)', color: 'var(--success)', borderRadius: 8, fontSize: 12.5 }}>
            Code sent (mock). Use <strong>123456</strong> on the reset page.
          </div>
          <div className="auth-links" style={{ justifyContent: 'center' }}>
            <Link href={loginHref}>Back to sign in</Link>
          </div>
        </>
      )}
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
