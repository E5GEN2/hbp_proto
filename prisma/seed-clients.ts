/**
 * Seeds a few client users for testing — alongside admins/system config.
 * Run after db:clean to have something to play with without needing to
 * register fresh every time.
 *
 *   pnpm tsx prisma/seed-clients.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function nextUserId() {
  const rows = await prisma.user.findMany({ where: { id: { startsWith: 'USR-' } }, select: { id: true } });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

async function main() {
  console.log('🌱 Seeding test clients…');

  const hash = (pw: string) => bcrypt.hashSync(pw, 10);
  const exists = (email: string) => prisma.user.findUnique({ where: { email } });

  const clients = [
    {
      name: 'Demo Client', email: 'demo@example.com', password: 'demo1234',
      tier: 'STANDARD' as const, country: 'US', telegram: null,
      balance: 0, acquisition: 'organic',
    },
    {
      name: 'Jordan Lee', email: 'jordan@example.com', password: 'demo1234',
      tier: 'PRO' as const, country: 'US', telegram: 'jordanlee',
      balance: 250, acquisition: 'campaign-launch',
    },
    {
      name: 'Yuki Tanaka', email: 'yuki@example.com', password: 'demo1234',
      tier: 'VIP' as const, country: 'JP', telegram: 'yukit',
      balance: 500, acquisition: 'referral',
    },
  ];

  let counter = await nextUserId();

  for (const c of clients) {
    if (await exists(c.email)) {
      console.log(`  ↪ ${c.email} already exists — skipping`);
      continue;
    }
    const id = `USR-${String(counter++).padStart(5, '0')}`;
    await prisma.user.create({
      data: {
        id, name: c.name, email: c.email,
        passwordHash: hash(c.password),
        role: 'CLIENT',
        tier: c.tier, country: c.country, telegram: c.telegram,
        balance: c.balance, acquisition: c.acquisition,
        status: 'ACTIVE',
      },
    });
    // Seed locked balance payment method (matches createClient transition)
    await prisma.paymentMethod.create({
      data: {
        id: `pm_balance_${id.toLowerCase()}`,
        userId: id, kind: 'BALANCE', brand: 'Account balance',
        locked: true,
      },
    });
    // Optional: ledger entry for non-zero balance so the audit trail is consistent
    if (c.balance > 0) {
      await prisma.balanceLedgerEntry.create({
        data: {
          userId: id, op: 'MANUAL_ADJUST',
          amount: c.balance, balanceAfter: c.balance,
          note: 'Welcome credit (seed)',
        },
      });
    }
    console.log(`  ✓ Created ${c.name.padEnd(14)} ${c.email.padEnd(22)} (${id} · ${c.tier} · $${c.balance})`);
  }

  console.log('');
  console.log('✅ Done. Sign in with any of:');
  for (const c of clients) console.log(`  ${c.email.padEnd(22)} / ${c.password}  (${c.tier})`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
