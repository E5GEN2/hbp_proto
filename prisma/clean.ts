/**
 * Wipes all operational/transactional data while preserving:
 *  - Admin users (4 admins)
 *  - System settings (provider toggles, grace rules, flags, display, portal config)
 *  - Catalog master lists (carriers, regions, pools, etc.)
 *  - Notification templates
 *  - Provisioning rules
 *
 * Use this to start end-to-end testing with a clean slate. Admins can log in
 * with their existing credentials and start fresh (create plans, register
 * proxies, etc.).
 *
 * Requires CONFIRM=YES env var to prevent accidental runs.
 *
 *   CONFIRM=YES pnpm tsx prisma/clean.ts
 *   DATABASE_URL=... CONFIRM=YES pnpm tsx prisma/clean.ts   (e.g. for Railway public URL)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRM !== 'YES') {
    console.error('❌ Refusing to run without CONFIRM=YES env var.');
    console.error('   This wipes orders/payments/proxies/clients/logs/notifications/plans.');
    console.error('   Re-run with:   CONFIRM=YES pnpm tsx prisma/clean.ts');
    process.exit(1);
  }

  console.log('🧹 Cleaning database…');
  console.log('   Keeping: admins · system settings · catalogs · templates · provisioning rules');
  console.log('   Wiping:  clients · orders · payments · invoices · proxies · assignments · logs · notifications · ledger · payment methods · whitelist · notes · drafts · tickets');
  console.log('');

  const before = await summary();
  console.log('Before:', JSON.stringify(before, null, 2));

  await prisma.$transaction([
    // Drafts first (depend on user)
    prisma.checkoutDraft.deleteMany(),
    // Ticket replies → tickets
    prisma.ticketReply.deleteMany(),
    prisma.ticket.deleteMany(),
    // Notes (polymorphic, no FK constraints but cleanup anyway)
    prisma.entityNote.deleteMany(),
    // Logs (entire audit history of test runs)
    prisma.log.deleteMany(),
    // Balance ledger → user
    prisma.balanceLedgerEntry.deleteMany(),
    // Notifications → user
    prisma.notification.deleteMany(),
    // Whitelist → proxy + user
    prisma.proxyWhitelist.deleteMany(),
    // Assignments → order + proxy
    prisma.assignment.deleteMany(),
    // Invoices → payment + order + client
    prisma.invoice.deleteMany(),
    // Payments → order + client
    prisma.payment.deleteMany(),
    // Orders → client + plan
    prisma.order.deleteMany(),
    // Payment methods → user
    prisma.paymentMethod.deleteMany(),
    // Proxies
    prisma.proxy.deleteMany(),
    // Plans (admin will create real ones)
    prisma.plan.deleteMany(),
    // Webhooks + API keys
    prisma.webhook.deleteMany(),
    prisma.apiKey.deleteMany(),
    // Finally: non-admin users (clients only)
    prisma.user.deleteMany({ where: { role: 'CLIENT' } }),
  ]);

  console.log('');
  const after = await summary();
  console.log('After: ', JSON.stringify(after, null, 2));
  console.log('');
  console.log('✅ Clean complete.');
  console.log('');
  console.log('Admin credentials still work:');
  console.log('  admin@hbp.local / admin1234   (super)');
  console.log('  ops@hbp.local / admin1234     (ops)');
  console.log('  support@hbp.local / admin1234 (support)');
  console.log('');
  console.log('Next: log in as admin → /admin/plans/new → create your first plan.');
}

async function summary() {
  return {
    users: {
      admins: await prisma.user.count({ where: { role: { in: ['ADMIN_SUPER', 'ADMIN_OPS', 'ADMIN_SUPPORT'] } } }),
      clients: await prisma.user.count({ where: { role: 'CLIENT' } }),
    },
    plans: await prisma.plan.count(),
    orders: await prisma.order.count(),
    payments: await prisma.payment.count(),
    invoices: await prisma.invoice.count(),
    proxies: await prisma.proxy.count(),
    assignments: await prisma.assignment.count(),
    notifications: await prisma.notification.count(),
    ledger: await prisma.balanceLedgerEntry.count(),
    logs: await prisma.log.count(),
    paymentMethods: await prisma.paymentMethod.count(),
    notes: await prisma.entityNote.count(),
    catalog: await prisma.catalogItem.count(),
    templates: await prisma.notificationTemplate.count(),
    provisioning: await prisma.provisioningRule.count(),
    settings: await prisma.systemSetting.count(),
  };
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
