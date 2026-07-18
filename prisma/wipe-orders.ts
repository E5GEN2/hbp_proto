/**
 * Clean-slate for order↔proxy flow testing. Deletes every ORDER and its
 * dependent records, and resets all proxies back to the pool — but KEEPS
 * plans, proxies, clients, catalogs, settings and admins.
 *
 * Wipes:  orders · payments · invoices · assignments · checkout drafts ·
 *         order/proxy-scoped notifications & logs · order/proxy notes
 * Resets: every proxy → AVAILABLE / HEALTHY / unassigned (security markers
 *         stamped, as if freshly returned to pool)
 * Keeps:  plans · proxies (rows) · clients (+ balances) · catalog · settings ·
 *         notification templates · provisioning rules · admins
 *
 *   DATABASE_URL=<railway public url> CONFIRM=YES pnpm tsx prisma/wipe-orders.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function summary() {
  return {
    plans: await prisma.plan.count(),
    orders: await prisma.order.count(),
    payments: await prisma.payment.count(),
    assignments: await prisma.assignment.count(),
    proxies: await prisma.proxy.count(),
    proxiesAvailable: await prisma.proxy.count({ where: { status: 'AVAILABLE' } }),
    clients: await prisma.user.count({ where: { role: 'CLIENT' } }),
  };
}

async function main() {
  if (process.env.CONFIRM !== 'YES') {
    console.error('❌ Refusing to run without CONFIRM=YES. This deletes ALL orders (plans/proxies/clients kept).');
    process.exit(1);
  }
  console.log('Before:', JSON.stringify(await summary(), null, 2));

  const now = new Date();
  await prisma.$transaction([
    prisma.checkoutDraft.deleteMany(),
    prisma.assignment.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.order.deleteMany(),
    // Order/proxy-scoped chatter — leave client-account notifications alone.
    prisma.notification.deleteMany({ where: { OR: [{ link: { contains: '/orders/' } }, { link: { contains: '/proxies/' } }] } }),
    prisma.entityNote.deleteMany({ where: { objectType: { in: ['ORDER', 'PAYMENT', 'PROXY'] } } }),
    prisma.log.deleteMany({ where: { objectType: { in: ['ORDER', 'PAYMENT', 'PROXY'] } } }),
    // Every proxy back to a clean pool state (coherent: AVAILABLE ⟹ HEALTHY).
    prisma.proxy.updateMany({
      data: { status: 'AVAILABLE', health: 'HEALTHY', currentOrderId: null, securityResetAt: now, passwordRotatedAt: now, ipRotatedAt: now },
    }),
  ]);

  console.log('After: ', JSON.stringify(await summary(), null, 2));
  console.log('✅ Orders wiped, proxies reset to pool. Plans/proxies/clients kept.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
