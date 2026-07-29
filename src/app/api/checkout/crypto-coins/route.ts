import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { npEnabled, NP_COINS, npMinAmountUsd } from '@/lib/nowpayments';

export const dynamic = 'force-dynamic';

// Coin list for the in-portal crypto picker: the static whitelist annotated
// with each coin's live USD minimum (NP min-amount, 5-min in-process cache in
// npMinAmountUsd). minUsd:null = lookup unavailable — the UI keeps the coin
// selectable and npCreatePayment surfaces NP's own error if it's truly below
// minimum.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Same gate as every sibling payment route — an unverified account must not
  // trigger the 15-request NP min-amount fan-out either.
  if (!session.user.emailVerified) return NextResponse.json({ error: 'Verify your email to continue' }, { status: 403 });
  if (!npEnabled()) return NextResponse.json({ coins: [] });

  const coins = await Promise.all(
    NP_COINS.map(async c => ({
      code: c.code,
      label: c.label,
      network: c.network,
      memo: c.memo ?? false,
      minUsd: await npMinAmountUsd(c.code),
    })),
  );
  return NextResponse.json({ coins });
}
