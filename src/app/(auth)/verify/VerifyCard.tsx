'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const RESEND_COOLDOWN_S = 60;

export function VerifyCard({ email, token, ret, hasSession, alreadyVerified, sendFailed }: {
  email: string | null;
  token: string | null;
  ret: string;
  hasSession: boolean;
  alreadyVerified: boolean;
  sendFailed?: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(sendFailed ? 'We couldn’t send the email — press “Resend code” to try again.' : null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [wrongAccount, setWrongAccount] = useState(false); // link for a different account than the current session
  const [cooldown, setCooldown] = useState(0);
  const tokenFired = useRef(false);

  // Magic-link mode: confirm automatically on mount.
  useEffect(() => {
    if (!token || tokenFired.current) return;
    tokenFired.current = true;
    (async () => {
      setBusy(true);
      const r = await fetch('/api/auth/verify/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setBusy(false);
      if (r.ok) {
        const j = await r.json().catch(() => ({} as any));
        setDone(true);
        // The link verifies the TOKEN's account. If this browser is signed in
        // as someone else, don't push them into a portal that isn't the one
        // that got verified — hand them to sign-in instead.
        const mismatch = hasSession && email && j.email && j.email !== email;
        if (hasSession && !mismatch) {
          router.push(ret);
          router.refresh();
        } else if (mismatch) {
          setWrongAccount(true);
        }
      } else {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? 'Verification failed');
      }
    })();
  }, [token, hasSession, email, ret, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const r = await fetch('/api/auth/verify/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (r.ok) {
      setDone(true);
      router.push(ret);
      router.refresh();
    } else {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? 'Verification failed');
    }
  }

  async function resend() {
    setErr(null);
    setInfo(null);
    setBusy(true);
    const r = await fetch('/api/auth/verify/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ return: ret }),
    });
    setBusy(false);
    if (r.ok) {
      setInfo('New code sent — check your inbox.');
      setCooldown(RESEND_COOLDOWN_S);
    } else {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? 'Could not send the email');
    }
  }

  // Link verified an account this browser isn't signed into (or no session) —
  // show the outcome and hand over to sign-in.
  if ((done && !hasSession) || wrongAccount) {
    return (
      <div className="auth-card">
        <div className="auth-title">Email verified ✓</div>
        <div className="auth-subtitle">Your account is active — sign in to continue.</div>
        <div className="auth-links" style={{ marginTop: 16 }}>
          <Link className="btn primary lg" style={{ width: '100%', textAlign: 'center' }} href={`/login?verified=1&return=${encodeURIComponent(ret)}`}>Sign in</Link>
        </div>
      </div>
    );
  }

  if (token) {
    return (
      <div className="auth-card">
        <div className="auth-title">{err ? 'Verification failed' : 'Verifying…'}</div>
        {err && <div className="form-help error" style={{ marginTop: 8 }}>{err}</div>}
        {err && hasSession && (
          <div className="auth-links"><Link href={`/verify?return=${encodeURIComponent(ret)}`}>Enter the code instead</Link></div>
        )}
        {err && !hasSession && (
          <div className="auth-links"><Link href="/login">Back to sign in</Link></div>
        )}
      </div>
    );
  }

  if (alreadyVerified) {
    return (
      <div className="auth-card">
        <div className="auth-title">Email already verified</div>
        <div className="auth-links"><Link href={ret}>Continue</Link></div>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <div className="auth-title">Confirm your email</div>
      <div className="auth-subtitle">
        We sent a 6-digit code{email ? <> to <strong>{email}</strong></> : null}. Enter it below, or open the link from the email.
      </div>
      <form className="auth-form" onSubmit={submitCode}>
        <div className="form-row">
          <label className="form-label">Verification code</label>
          <input
            className="form-input mono"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
            style={{ letterSpacing: 6, textAlign: 'center', fontSize: 18 }}
          />
        </div>
        {err && <div className="form-help error">{err}</div>}
        {info && <div className="form-help" style={{ color: 'var(--success)' }}>{info}</div>}
        <button className="btn primary lg" type="submit" disabled={busy || code.length !== 6} style={{ width: '100%', marginTop: 16 }}>
          {busy ? 'Checking…' : 'Verify email'}
        </button>
      </form>
      <div className="auth-links">
        <a role="button" style={{ cursor: cooldown > 0 || busy ? 'default' : 'pointer', opacity: cooldown > 0 ? 0.6 : 1 }}
           onClick={() => { if (!busy && cooldown <= 0) resend(); }}>
          {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
        </a>
      </div>
    </div>
  );
}
