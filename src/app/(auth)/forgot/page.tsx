'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// Automated password reset isn't built yet (no email pipeline). Until it ships,
// recovery goes through support — no mock "code sent" dead-end.
function ForgotForm() {
  const params = useSearchParams();
  const loginHref = `/login${params.get('from') === 'site' ? '?from=site' : ''}`;

  return (
    <div className="auth-card">
      <div className="auth-title">Forgot password?</div>
      <div className="auth-subtitle">
        Password reset is handled by our support team for now. Message us on Telegram
        from the account you registered with, and we&rsquo;ll restore access.
      </div>
      <a
        className="btn primary lg"
        style={{ width: '100%', marginTop: 24, display: 'flex', justifyContent: 'center' }}
        href="https://t.me/US5Gwetrust"
        target="_blank"
        rel="noreferrer"
      >
        Contact support on Telegram
      </a>
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
