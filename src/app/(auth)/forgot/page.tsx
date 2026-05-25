'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <div className="panel" style={{ width: 380, padding: 0 }}>
      <div style={{ padding: '28px 28px 8px' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Forgot password</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>Enter your email — we&rsquo;ll send a recovery code.</div>
      </div>
      {!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} style={{ padding: '8px 28px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <button className="btn primary" type="submit">Send code</button>
          <div style={{ marginTop: 8, fontSize: 12.5, textAlign: 'center' }}>
            <Link href="/login" style={{ color: 'var(--accent-text)' }}>Back to sign in</Link>
          </div>
        </form>
      ) : (
        <div style={{ padding: '8px 28px 24px' }}>
          <div style={{ padding: 12, background: 'var(--success-dim)', color: 'var(--success)', borderRadius: 8, fontSize: 12.5 }}>
            Code sent (mock). Use <strong>123456</strong> on the reset page.
          </div>
          <div style={{ marginTop: 12, fontSize: 12.5, textAlign: 'center' }}>
            <Link href="/login" className="btn">Back to sign in</Link>
          </div>
        </div>
      )}
    </div>
  );
}
