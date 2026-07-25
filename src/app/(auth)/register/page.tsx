'use client';
import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { passwordChecklist, passwordPolicyError } from '@/lib/password-policy';
import { safeReturn } from '@/lib/safe-return';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ret = safeReturn(params.get('return')) ?? '/dashboard';
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
    const policyErr = passwordPolicyError(password);
    if (policyErr) { setErr(policyErr); return; }
    setLoading(true);
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, email, password, return: ret }),
    });
    const j = await r.json().catch(() => ({} as any));
    if (!r.ok) {
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
    // Email confirmation comes first (owner items 2-3); the chosen plan
    // survives the detour — /verify hands ?return back after the code.
    if (j.verify) {
      const q = new URLSearchParams({ return: ret });
      if (j.sent === false) q.set('sent', '0'); // honest "couldn't send" on a mail outage
      router.push(`/verify?${q.toString()}`);
    } else {
      router.push(ret);
    }
    router.refresh();
  }

  const checks = passwordChecklist(password);
  const Check = ({ ok, label }: { ok: boolean; label: string }) => (
    <span style={{ color: ok ? 'var(--success)' : 'var(--muted)', fontSize: 11.5, marginRight: 12 }}>
      {ok ? '✓' : '·'} {label}
    </span>
  );

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
          <div style={{ marginTop: 6 }}>
            <Check ok={checks.length} label="8+ characters" />
            <Check ok={checks.upper} label="Uppercase letter" />
            <Check ok={checks.digit} label="Digit" />
          </div>
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
