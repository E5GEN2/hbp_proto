'use client';
import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getSession } from 'next-auth/react';
import { safeReturn } from '@/lib/safe-return';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ret = safeReturn(params.get('return')) ?? '/';
  const fromSite = params.get('from') === 'site';
  const carry = fromSite ? '&from=site' : '';
  const registerHref = `/register?return=${encodeURIComponent(ret)}${carry}`;
  const forgotHref = `/forgot${fromSite ? '?from=site' : ''}`;
  const justReset = params.get('reset') === '1';
  const justVerified = params.get('verified') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const res = await signIn('credentials', { redirect: false, email, password });
    if (res?.error) {
      setLoading(false);
      setErr('Sign-in failed. Check your credentials.');
      return;
    }
    // A client who registered but never confirmed their email still gets
    // routed through /verify — and the chosen plan (ret) survives the gate.
    const s = await getSession();
    setLoading(false);
    if (s?.user && s.user.role === 'CLIENT' && !s.user.emailVerified) {
      router.push(`/verify?return=${encodeURIComponent(ret)}`);
    } else {
      router.push(ret);
    }
    router.refresh();
  }

  return (
    <div className="auth-card">
      <div className="auth-head">
        <div className="auth-title">Sign in</div>
        <div className="auth-switch">Don&rsquo;t have an account yet? <Link href={registerHref}>Create account</Link></div>
      </div>
      {justReset && (
        <div className="form-help" style={{ color: 'var(--success)', marginTop: 12 }}>
          Password updated — sign in with your new password.
        </div>
      )}
      {justVerified && (
        <div className="form-help" style={{ color: 'var(--success)', marginTop: 12 }}>
          Email verified — sign in to continue.
        </div>
      )}
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
        <button className="btn primary lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: 24 }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="auth-links">
        <Link href={forgotHref}>Forgot password?</Link>
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
