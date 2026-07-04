import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from '@/lib/auth';
import { runSweep } from '@/lib/sweep';

export const dynamic = 'force-dynamic';

// Manual/external trigger for the lifecycle sweep. The in-process loop
// (instrumentation.ts) is the primary driver; this route lets an admin — or an
// external cron with CRON_SECRET — force a run and read the result.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('x-cron-secret');
  let authorized = Boolean(secret && header && header === secret);
  if (!authorized) {
    const session = await getServerSession(authOptions);
    authorized = Boolean(session && isAdminRole(session.user.role));
  }
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await runSweep();
  return NextResponse.json(result);
}

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }
