import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { npEnabled, NP_COINS } from '@/lib/nowpayments';

export const dynamic = 'force-dynamic';

// Coin list for the in-portal crypto picker (static whitelist). minUsd is
// intentionally null: NP's /v1/min-amount is unreliable (see CRYPTO_MIN_USD in
// np-coins) — a single flat $10 floor gates crypto amounts instead, so the
// picker no longer needs (and must not use, or it would wrongly disable
// USDT-TRC20 at $10–11) per-coin minimums.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.emailVerified) return NextResponse.json({ error: 'Verify your email to continue' }, { status: 403 });
  if (!npEnabled()) return NextResponse.json({ coins: [] });

  const coins = NP_COINS.map(c => ({
    code: c.code,
    label: c.label,
    network: c.network,
    memo: c.memo ?? false,
    minUsd: null as number | null,
  }));
  return NextResponse.json({ coins });
}
