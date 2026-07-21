import { PrismaClient, type CatalogKind, type NotificationKind, type CapacityState, type OrderStatus, type PaymentStatus, type UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const now = () => new Date();
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);
const past = (n: number) => new Date(Date.now() - n * 86_400_000);
const pastHours = (n: number) => new Date(Date.now() - n * 3_600_000);

async function main() {
  console.log('🌱 Seeding database…');

  // Wipe in dependency order
  await prisma.$transaction([
    prisma.checkoutDraft.deleteMany(),
    prisma.ticketReply.deleteMany(),
    prisma.ticket.deleteMany(),
    prisma.entityNote.deleteMany(),
    prisma.log.deleteMany(),
    prisma.balanceLedgerEntry.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.proxyWhitelist.deleteMany(),
    prisma.assignment.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.order.deleteMany(),
    prisma.proxy.deleteMany(),
    prisma.paymentMethod.deleteMany(),
    prisma.plan.deleteMany(),
    prisma.provisioningRule.deleteMany(),
    prisma.notificationTemplate.deleteMany(),
    prisma.catalogItem.deleteMany(),
    prisma.systemSetting.deleteMany(),
    prisma.webhook.deleteMany(),
    prisma.apiKey.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // ── CATALOG MASTER LISTS ─────────────────────────────────────────────
  const catalogData: { kind: CatalogKind; values: string[] }[] = [
    { kind: 'CARRIER', values: ['Verizon', 'T-Mobile', 'AT&T'] },
    { kind: 'REGION', values: ['US East', 'US West', 'US Central'] },
    { kind: 'POOL', values: ['Verizon-East-A', 'Verizon-East-B', 'Verizon-West', 'TMobile-East', 'TMobile-West', 'TMobile-Central', 'ATT-Central', 'ATT-West', 'ATT-East'] },
    { kind: 'PROTOCOL', values: ['HTTP', 'HTTPS', 'SOCKS5'] },
    { kind: 'ROTATION', values: ['Sticky', 'Rotate 5m', 'Rotate 10m', 'Rotate 30m', 'On-demand URL'] },
    { kind: 'TRAFFIC', values: ['Unlimited', '50 GB', '100 GB', '250 GB'] },
    { kind: 'DURATION', values: ['7', '30', '90'] },
    { kind: 'VISIBILITY', values: ['Public', 'Internal'] },
    { kind: 'CURRENCY', values: ['USD', 'EUR'] },
  ];
  for (const c of catalogData) {
    await prisma.catalogItem.createMany({
      data: c.values.map((v, i) => ({ kind: c.kind, value: v, sortOrder: i })),
    });
  }

  // ── SYSTEM SETTINGS ──────────────────────────────────────────────────
  const settings: { key: string; value: any }[] = [
    { key: 'systemAutoProvisionOnPayment', value: false }, // auto-backfill master switch — OFF (opt-in); admin enables in Settings → Flags
    { key: 'autoReplaceOnFaulty', value: true },
    { key: 'autoReleaseAfterGrace', value: true },
    { key: 'require2FAForRefund', value: false },
    { key: 'requireNoteOnSuspend', value: true },
    { key: 'freezeNewOrders', value: false },
    { key: 'grace', value: { defaultGraceHours: 48, preRenewalReminderHours: 72, secondReminderHours: 24, thirdReminderHours: 0, VIPGraceHours: 96, ProGraceHours: 72, StandardGraceHours: 48, autoRenew24hBeforeExpiry: true, keepProxyDuringGrace: true, autoSuspendAfter3Fails: true } },
    { key: 'flags', value: { maxConcurrentOrdersPerClient: 10, maxProxyReplacementsPerOrder: 3, supportRefundCapUSD: 100, discountCapWithoutSuperApprovalPercent: 15 } },
    { key: 'providers', value: { stripe: { enabled: true, accountId: 'acct_demo_1234', publishableKey: 'pk_test_demo', webhookSecret: 'whsec_demo' }, crypto: { enabled: true, confirmations: 1, currencies: ['USDT', 'USDC', 'BTC'] }, bank: { enabled: true }, paypal: { enabled: false } } },
    { key: 'notifications', value: { 'order-created': true, 'payment-confirmed': true, 'proxy-assigned': true, 'pre-renewal-72h': true, 'grace-started': true, 'order-expired-final': true, 'replacement-completed': true, 'refund-issued': true, 'admin-new-order': true, 'admin-payment-failed': true, 'admin-proxy-faulty': true, 'admin-quota-85': true, 'admin-chargeback': true, 'admin-refund-request': true } },
    { key: 'display', value: { timeFormat: 'UTC' } },
    { key: 'portalConfig', value: { telegramUrl: 'https://t.me/proxysupport', paymentMethods: { crypto: true, balance: true } } },
  ];
  for (const s of settings) {
    await prisma.systemSetting.create({ data: s });
  }

  // ── PROVISIONING RULES ───────────────────────────────────────────────
  const provRules = [
    { id: 'PRV-001', carrier: 'Verizon', region: 'US East', defaultPool: 'Verizon-East-A', fallbackPools: ['Verizon-East-B'], autoAssign: true, notes: 'Highest-quality region' },
    { id: 'PRV-002', carrier: 'Verizon', region: 'US West', defaultPool: 'Verizon-West', fallbackPools: [], autoAssign: true, notes: '' },
    { id: 'PRV-003', carrier: 'T-Mobile', region: 'US West', defaultPool: 'TMobile-West', fallbackPools: ['TMobile-Central'], autoAssign: true, notes: '' },
    { id: 'PRV-004', carrier: 'T-Mobile', region: 'US East', defaultPool: 'TMobile-East', fallbackPools: [], autoAssign: true, notes: '' },
    { id: 'PRV-005', carrier: 'T-Mobile', region: 'US Central', defaultPool: 'TMobile-Central', fallbackPools: ['TMobile-West'], autoAssign: false, notes: 'Manual pool selection at checkout' },
    { id: 'PRV-006', carrier: 'AT&T', region: 'US Central', defaultPool: 'ATT-Central', fallbackPools: ['ATT-West'], autoAssign: true, notes: '' },
    { id: 'PRV-007', carrier: 'AT&T', region: 'US West', defaultPool: 'ATT-West', fallbackPools: [], autoAssign: true, notes: '' },
  ];
  for (const r of provRules) await prisma.provisioningRule.create({ data: r });

  // ── NOTIFICATION TEMPLATES ───────────────────────────────────────────
  await prisma.notificationTemplate.createMany({
    data: [
      { id: 'TPL-001', name: '72h pre-renewal reminder', channel: 'EMAIL', trigger: 'EXPIRING_3D', subject: 'Your order {{order.id}} expires in 3 days', body: 'Hi {{client.name}},\n\nYour order {{order.id}} ({{plan.name}}) expires on {{order.expires}}.\n\nRenew now to keep your proxies active.' },
      { id: 'TPL-002', name: '24h reminder', channel: 'EMAIL', trigger: 'EXPIRING_24H', subject: 'Final reminder — {{order.id}} expires tomorrow', body: 'Hi {{client.name}},\n\nYour order {{order.id}} expires within 24 hours.\n\nDon\'t lose your proxies — renew now.' },
      { id: 'TPL-003', name: 'Grace started', channel: 'EMAIL', trigger: 'GRACE', subject: 'Order {{order.id}} is now in grace period', body: 'Hi {{client.name}},\n\n{{order.id}} entered grace. You have {{order.graceLeft}} left until proxies are released.' },
      { id: 'TPL-004', name: 'Payment awaiting', channel: 'EMAIL', trigger: 'AWAITING', subject: 'Awaiting payment for {{order.id}}', body: 'We received your order {{order.id}} but payment is still pending. Complete the payment to activate.' },
      { id: 'TPL-005', name: 'Replacement pending', channel: 'TELEGRAM', trigger: 'REPLACEMENT_PENDING', subject: '', body: 'Proxy {{proxy.id}} on order {{order.id}} is being replaced. ETA <24h.' },
      { id: 'TPL-006', name: 'Order created', channel: 'EMAIL', trigger: 'ORDER_CREATED', subject: 'Order {{order.id}} received', body: 'Thanks {{client.name}} — your order {{order.id}} for {{plan.name}} is being processed.' },
    ],
  });

  // ── USERS ────────────────────────────────────────────────────────────
  const hash = (pw: string) => bcrypt.hashSync(pw, 10);

  // Admins
  const admins = [
    { id: 'ADM-001', name: 'Alex Carter',  email: 'admin@hbp.local',   role: 'ADMIN_SUPER'  as UserRole, initials: 'AC', ipAddress: '203.0.113.10', avatarColor: '#5b8cff', tier: 'VIP' as const },
    { id: 'ADM-002', name: 'Maria Diaz',   email: 'ops@hbp.local',     role: 'ADMIN_OPS'    as UserRole, initials: 'MD', ipAddress: '203.0.113.11', avatarColor: '#a78bfa', tier: 'STANDARD' as const },
    { id: 'ADM-003', name: 'Dana Patel',   email: 'support@hbp.local', role: 'ADMIN_SUPPORT'as UserRole, initials: 'DP', ipAddress: '203.0.113.12', avatarColor: '#3ccf8e', tier: 'STANDARD' as const },
    { id: 'ADM-SYS', name: 'System',       email: 'system@hbp.local',  role: 'ADMIN_SUPER'  as UserRole, initials: 'SY', ipAddress: '127.0.0.1',    avatarColor: '#ffb84d', tier: 'STANDARD' as const },
  ];
  for (const a of admins) {
    await prisma.user.create({
      data: { ...a, passwordHash: hash('admin1234'), country: 'US' },
    });
  }

  // Demo client
  const demoUser = await prisma.user.create({
    data: {
      id: 'USR-00001',
      name: 'Demo User',
      email: 'demo@example.com',
      passwordHash: hash('demo1234'),
      role: 'CLIENT',
      country: 'US',
      tier: 'VIP',
      balance: 500,
      createdAt: past(60),
    },
  });

  // Extra clients for admin to see
  const extraClients = [
    { id: 'USR-00002', name: 'Jordan Lee',     email: 'jordan@example.com',  tier: 'PRO' as const,      status: 'ACTIVE' as const,  risk: 'NONE' as const,   country: 'US', telegram: '@jordanlee', joined: past(45), totalOrders: 4 },
    { id: 'USR-00003', name: 'Priya Singh',    email: 'priya@example.com',   tier: 'PRO' as const,      status: 'ACTIVE' as const,  risk: 'NONE' as const,   country: 'IN', telegram: '@priya_s',  joined: past(120), totalOrders: 7 },
    { id: 'USR-00004', name: 'Marco Rossi',    email: 'marco@example.com',   tier: 'STANDARD' as const, status: 'ACTIVE' as const,  risk: 'REVIEW' as const, country: 'IT', telegram: null,        joined: past(20), totalOrders: 1 },
    { id: 'USR-00005', name: 'Yuki Tanaka',    email: 'yuki@example.com',    tier: 'VIP' as const,      status: 'ACTIVE' as const,  risk: 'NONE' as const,   country: 'JP', telegram: '@yukit',    joined: past(200), totalOrders: 12 },
    { id: 'USR-00006', name: 'Sara Khan',      email: 'sara@example.com',    tier: 'STANDARD' as const, status: 'CHURNED' as const, risk: 'NONE' as const,   country: 'UAE',telegram: null,        joined: past(300), totalOrders: 2 },
    { id: 'USR-00007', name: 'Felix Müller',   email: 'felix@example.com',   tier: 'STANDARD' as const, status: 'BLOCKED' as const, risk: 'FLAG' as const,   country: 'DE', telegram: null,        joined: past(90),  totalOrders: 1 },
  ];
  for (const c of extraClients) {
    await prisma.user.create({
      data: {
        id: c.id,
        name: c.name,
        email: c.email,
        passwordHash: hash('demo1234'),
        role: 'CLIENT',
        tier: c.tier,
        status: c.status,
        risk: c.risk,
        country: c.country,
        telegram: c.telegram,
        balance: 0,
        createdAt: c.joined,
        ...(c.status === 'BLOCKED' ? { blockedAt: past(5), blockedReason: 'Suspected fraud — flagged by ops' } : {}),
        ...(c.risk === 'REVIEW' ? { riskNote: 'Multiple chargebacks last quarter — monitor' } : {}),
      },
    });
  }

  // Demo user's payment methods
  await prisma.paymentMethod.create({
    data: {
      id: 'pm_balance',
      userId: demoUser.id,
      kind: 'BALANCE',
      brand: 'Account balance',
      isDefault: false,
      locked: true,
      addedAt: past(90),
    },
  });
  await prisma.paymentMethod.create({
    data: {
      id: 'pm_visa_4242',
      userId: demoUser.id,
      kind: 'CARD',
      brand: 'Visa',
      last4: '4242',
      exp: '12/27',
      isDefault: true,
      addedAt: past(60),
    },
  });

  // ── PLANS ────────────────────────────────────────────────────────────
  const planData = [
    { id: 'PLAN-VRZN-7D',  name: 'Verizon 7-day East',     carrier: 'Verizon',  region: 'US East',    pool: 'Verizon-East-A',  durationDays: 7,  price: 39,  availableQuota: 100, capacityState: null,           autoProvision: true,  description: 'Premium 4G LTE mobile proxies, US East. Sticky session 7-day window.' },
    { id: 'PLAN-TMOB-7D',  name: 'T-Mobile 7-day West',    carrier: 'T-Mobile', region: 'US West',    pool: 'TMobile-West',    durationDays: 7,  price: 39,  availableQuota: 80,  capacityState: null,           autoProvision: true,  description: 'T-Mobile mobile proxies in US West. Great for ad-verification.' },
    { id: 'PLAN-ATAT-7D',  name: 'AT&T 7-day Central',     carrier: 'AT&T',     region: 'US Central', pool: 'ATT-Central',     durationDays: 7,  price: 39,  availableQuota: 60,  capacityState: 'LOW' as CapacityState,  autoProvision: true,  description: 'AT&T mobile proxies in US Central. Limited availability.' },
    { id: 'PLAN-VRZN-30D', name: 'Verizon 30-day East',    carrier: 'Verizon',  region: 'US East',    pool: 'Verizon-East-B',  durationDays: 30, price: 129, availableQuota: 80,  capacityState: null,           autoProvision: true,  description: 'Premium 4G LTE mobile proxies, US East. Most popular plan.' },
    { id: 'PLAN-TMOB-30D', name: 'T-Mobile 30-day Central',carrier: 'T-Mobile', region: 'US Central', pool: 'TMobile-Central', durationDays: 30, price: 129, availableQuota: 70,  capacityState: null,           autoProvision: true,  description: 'T-Mobile mobile proxies in US Central. Balanced performance.' },
    { id: 'PLAN-ATAT-30D', name: 'AT&T 30-day West',       carrier: 'AT&T',     region: 'US West',    pool: 'ATT-West',        durationDays: 30, price: 129, availableQuota: 50,  capacityState: null,           autoProvision: true,  description: 'AT&T mobile proxies in US West. Reliable coverage.' },
    { id: 'PLAN-VRZN-90D', name: 'Verizon 90-day West',    carrier: 'Verizon',  region: 'US West',    pool: 'Verizon-West',    durationDays: 90, price: 329, availableQuota: 40,  capacityState: 'LOW' as CapacityState,  autoProvision: true,  description: 'Long-term Verizon proxies. Best value per day.' },
    { id: 'PLAN-TMOB-90D', name: 'T-Mobile 90-day East',   carrier: 'T-Mobile', region: 'US East',    pool: 'TMobile-East',    durationDays: 90, price: 329, availableQuota: 50,  capacityState: null,           autoProvision: true,  description: 'Quarterly T-Mobile plan. Locked-in pricing.' },
    { id: 'PLAN-ATAT-90D', name: 'AT&T 90-day Central',    carrier: 'AT&T',     region: 'US Central', pool: 'ATT-Central',     durationDays: 90, price: 329, availableQuota: 30,  capacityState: 'LOW' as CapacityState,  autoProvision: false, description: 'AT&T 90-day plan — manual fulfilment (24h delivery).' },
    { id: 'PLAN-VRZN-30D-INTERNAL', name: 'Internal QA — Verizon 30d', carrier: 'Verizon', region: 'US East', pool: 'Verizon-East-A', durationDays: 30, price: 0, availableQuota: 5, capacityState: null, autoProvision: true, description: 'Internal-only plan for QA. Hidden from clients.' },
  ];
  for (const p of planData) {
    await prisma.plan.create({
      data: {
        id: p.id,
        name: p.name,
        internalSku: `SKU-${p.id.split('-').slice(1).join('-')}`,
        description: p.description,
        visibility: p.id.includes('INTERNAL') ? 'INTERNAL' : 'PUBLIC',
        carrier: p.carrier,
        region: p.region,
        pool: p.pool,
        durationDays: p.durationDays,
        price: p.price,
        currency: 'USD',
        protocols: 'HTTP, SOCKS5',
        rotation: 'Sticky',
        traffic: 'Unlimited',
        availableQuota: p.availableQuota,
        capacityState: p.capacityState as any,
        active: true,
        autoProvision: p.autoProvision,
        autoRenewDefault: true,
        renewalAllowed: true,
      },
    });
  }

  // ── PROXIES ──────────────────────────────────────────────────────────
  const proxyData: any[] = [];
  let proxyIdCounter = 30412;
  function makeProxy(overrides: any) {
    const id = `PXY-${String(proxyIdCounter++).padStart(5, '0')}`;
    return {
      id,
      modem: `MDM-${String(proxyIdCounter % 100).padStart(2, '0')}`,
      imei: `35${Math.floor(Math.random() * 1e13).toString().padStart(13, '0')}`,
      city: 'New York',
      ip: `45.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
      port: 10000 + proxyIdCounter,
      username: `demo_${proxyIdCounter}`,
      password: Math.random().toString(36).slice(2, 12),
      rotateToken: Math.random().toString(36).slice(2, 18),
      status: 'AVAILABLE' as const,
      health: 'HEALTHY' as const,
      uptime: 99.8,
      speedMbps: 50,
      latency: 65,
      trafficUsedMB: 0,
      trafficLimitMB: 0,
      autoRotateMin: 0,
      lastRotated: past(2),
      registeredAt: past(60),
      ...overrides,
    };
  }

  // Available pool — Verizon East
  for (let i = 0; i < 8; i++) {
    proxyData.push(makeProxy({ carrier: 'Verizon', region: 'US East', pool: 'Verizon-East-A', city: 'New York', autoRotateMin: [0, 5, 10, 30, 60, 240][i % 6] }));
  }
  // T-Mobile West pool
  for (let i = 0; i < 6; i++) {
    proxyData.push(makeProxy({ carrier: 'T-Mobile', region: 'US West', pool: 'TMobile-West', city: 'Los Angeles' }));
  }
  // AT&T Central pool
  for (let i = 0; i < 4; i++) {
    proxyData.push(makeProxy({ carrier: 'AT&T', region: 'US Central', pool: 'ATT-Central', city: 'Chicago' }));
  }
  // Some faulty/offline ones for the admin Health tab
  proxyData.push(makeProxy({ carrier: 'Verizon', region: 'US East', pool: 'Verizon-East-B', city: 'New York', status: 'FAULTY', health: 'OFFLINE', uptime: 87.2, speedMbps: 0, latency: null }));
  proxyData.push(makeProxy({ carrier: 'T-Mobile', region: 'US Central', pool: 'TMobile-Central', city: 'Chicago', health: 'DEGRADED', uptime: 94.1, latency: 140 }));
  proxyData.push(makeProxy({ carrier: 'AT&T', region: 'US West', pool: 'ATT-West', city: 'Los Angeles', status: 'MAINTENANCE', health: 'OFFLINE', uptime: 92.0, latency: null }));

  for (const p of proxyData) await prisma.proxy.create({ data: p });
  const allProxies = await prisma.proxy.findMany();
  const veProxies = allProxies.filter(p => p.carrier === 'Verizon' && p.region === 'US East' && p.pool === 'Verizon-East-A');
  const twProxies = allProxies.filter(p => p.carrier === 'T-Mobile' && p.region === 'US West' && p.pool === 'TMobile-West');

  // ── ORDERS + PAYMENTS + ASSIGNMENTS + INVOICES ───────────────────────
  type SeedOrderArgs = {
    id: string;
    clientId: string;
    planId: string;
    qty: number;
    unitPrice: number;
    region: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    autoRenew?: boolean;
    autoProvision?: boolean;
    createdAt: Date;
    activatedAt?: Date | null;
    expiresAt?: Date | null;
    paymentProvider?: string;
    paymentMethod?: string;
    paymentStatusOverride?: PaymentStatus;
    paymentNet?: number;
    paymentDate?: Date;
    assignProxyIds?: string[];
    credentialsSentAt?: Date | null;
    credentialsChannel?: 'EMAIL' | 'TELEGRAM' | 'BOTH' | 'MANUAL';
    exception?: any;
    excInfo?: string;
    cancelledReason?: string;
    cancelledAt?: Date;
  };

  async function createOrder(args: SeedOrderArgs) {
    const amount = args.unitPrice * args.qty;
    const o = await prisma.order.create({
      data: {
        id: args.id,
        clientId: args.clientId,
        planId: args.planId,
        qty: args.qty,
        unitPrice: args.unitPrice,
        amount,
        region: args.region,
        paymentStatus: args.paymentStatus,
        status: args.status,
        autoRenew: args.autoRenew ?? false,
        autoProvision: args.autoProvision ?? true,
        createdAt: args.createdAt,
        activatedAt: args.activatedAt ?? null,
        expiresAt: args.expiresAt ?? null,
        cancelledAt: args.cancelledAt ?? null,
        cancelledReason: args.cancelledReason ?? null,
        exception: args.exception ?? null,
        excInfo: args.excInfo ?? null,
        credentialsSentAt: args.credentialsSentAt ?? null,
        credentialsChannel: args.credentialsChannel ?? null,
      },
    });
    // Payment
    if (args.paymentProvider) {
      const payStatus = args.paymentStatusOverride ?? args.paymentStatus;
      const net = args.paymentNet ?? amount;
      const pay = await prisma.payment.create({
        data: {
          id: args.id.replace('ORD-', 'PAY-'),
          orderId: o.id,
          clientId: args.clientId,
          provider: args.paymentProvider,
          method: args.paymentMethod ?? 'Visa •• 4242',
          gross: amount,
          fees: amount * 0.03,
          net,
          status: payStatus,
          confirmedAt: payStatus === 'CONFIRMED' || payStatus === 'PAID' ? (args.paymentDate ?? args.createdAt) : null,
          createdAt: args.paymentDate ?? args.createdAt,
        },
      });
      if (payStatus === 'CONFIRMED' || payStatus === 'PAID') {
        await prisma.invoice.create({
          data: {
            id: args.id.replace('ORD-', 'INV-'),
            paymentId: pay.id,
            orderId: o.id,
            clientId: args.clientId,
            amount,
            createdAt: args.paymentDate ?? args.createdAt,
          },
        });
      }
    }
    // Assignments
    if (args.assignProxyIds && args.assignProxyIds.length) {
      let asnCounter = parseInt(args.id.replace('ORD-', ''), 10);
      for (const pid of args.assignProxyIds) {
        await prisma.assignment.create({
          data: {
            id: `ASN-${String(asnCounter * 10 + args.assignProxyIds.indexOf(pid)).padStart(5, '0')}`,
            orderId: o.id,
            proxyId: pid,
            assignedAt: args.activatedAt ?? args.createdAt,
            actorId: 'ADM-SYS',
          },
        });
        await prisma.proxy.update({
          where: { id: pid },
          data: { status: 'ASSIGNED', currentOrderId: o.id },
        });
      }
    }
    return o;
  }

  // ORD-10847 — Verizon 30d, qty 6, paid, active, 18 days left (demo user)
  await createOrder({
    id: 'ORD-10847',
    clientId: demoUser.id,
    planId: 'PLAN-VRZN-30D',
    qty: 6,
    unitPrice: 129,
    region: 'US East',
    status: 'ACTIVE',
    paymentStatus: 'PAID',
    paymentStatusOverride: 'CONFIRMED',
    autoRenew: false,
    createdAt: past(12),
    activatedAt: past(12),
    expiresAt: days(18),
    paymentProvider: 'Stripe',
    paymentMethod: 'Visa •• 4242',
    assignProxyIds: veProxies.slice(0, 6).map(p => p.id),
    credentialsSentAt: past(12),
    credentialsChannel: 'MANUAL',
  });

  // ORD-10846 — T-Mobile 90d, qty 6, paid, active, expires in 60 days, auto-renew on
  await createOrder({
    id: 'ORD-10846',
    clientId: demoUser.id,
    planId: 'PLAN-TMOB-90D',
    qty: 6,
    unitPrice: 329 / 6,
    region: 'US West',
    status: 'ACTIVE',
    paymentStatus: 'PAID',
    paymentStatusOverride: 'CONFIRMED',
    autoRenew: true,
    createdAt: past(30),
    activatedAt: past(30),
    expiresAt: days(60),
    paymentProvider: 'CoinPayments',
    paymentMethod: 'USDT-TRC20',
    assignProxyIds: twProxies.slice(0, 6).map(p => p.id),
    credentialsSentAt: past(30),
    credentialsChannel: 'MANUAL',
  });

  // ORD-10845 — T-Mobile 7d, expiring soon (2 days left)
  const remainingTw = twProxies.slice(6, 9);
  if (remainingTw.length < 3) {
    // create extras
    const extras: any[] = [];
    for (let i = 0; i < 3 - remainingTw.length; i++) {
      extras.push(makeProxy({ carrier: 'T-Mobile', region: 'US West', pool: 'TMobile-West', city: 'Los Angeles' }));
    }
    for (const e of extras) {
      await prisma.proxy.create({ data: e });
      remainingTw.push(e);
    }
  }
  await createOrder({
    id: 'ORD-10845',
    clientId: demoUser.id,
    planId: 'PLAN-TMOB-7D',
    qty: 3,
    unitPrice: 39,
    region: 'US West',
    status: 'ACTIVE',
    paymentStatus: 'PAID',
    paymentStatusOverride: 'CONFIRMED',
    autoRenew: false,
    createdAt: past(5),
    activatedAt: past(5),
    expiresAt: days(2),
    paymentProvider: 'Stripe',
    paymentMethod: 'Visa •• 4242',
    assignProxyIds: remainingTw.slice(0, 3).map(p => p.id),
    credentialsSentAt: past(5),
    credentialsChannel: 'MANUAL',
  });

  // ORD-10848 — AT&T 7d, qty 2, pending payment (new)
  await createOrder({
    id: 'ORD-10848',
    clientId: demoUser.id,
    planId: 'PLAN-ATAT-7D',
    qty: 2,
    unitPrice: 39,
    region: 'US Central',
    status: 'NEW',
    paymentStatus: 'PENDING',
    paymentStatusOverride: 'AWAITING',
    createdAt: pastHours(2),
    paymentProvider: 'Stripe',
    paymentMethod: 'Visa •• 4242',
  });

  // ── EXTRA ORDERS for admin to manage ─────────────────────────────────
  // Order with exception: paid but not provisioned
  await createOrder({
    id: 'ORD-10860',
    clientId: 'USR-00002',
    planId: 'PLAN-VRZN-30D',
    qty: 2,
    unitPrice: 129,
    region: 'US East',
    status: 'PROVISIONING',
    paymentStatus: 'PAID',
    paymentStatusOverride: 'CONFIRMED',
    createdAt: pastHours(4),
    paymentProvider: 'Stripe',
    paymentMethod: 'Visa •• 4242',
    exception: 'PAID_NOT_PROVISIONED',
    excInfo: 'Pool capacity hit; manual assignment required',
  });
  await createOrder({
    id: 'ORD-10861',
    clientId: 'USR-00003',
    planId: 'PLAN-TMOB-30D',
    qty: 4,
    unitPrice: 129,
    region: 'US Central',
    status: 'ACTIVE',
    paymentStatus: 'PAID',
    paymentStatusOverride: 'CONFIRMED',
    createdAt: past(18),
    activatedAt: past(18),
    expiresAt: days(12),
    paymentProvider: 'Stripe',
    paymentMethod: 'Visa •• 4242',
  });
  await createOrder({
    id: 'ORD-10862',
    clientId: 'USR-00005',
    planId: 'PLAN-VRZN-90D',
    qty: 3,
    unitPrice: 329,
    region: 'US West',
    status: 'ACTIVE',
    paymentStatus: 'PAID',
    paymentStatusOverride: 'CONFIRMED',
    autoRenew: true,
    createdAt: past(45),
    activatedAt: past(45),
    expiresAt: days(45),
    paymentProvider: 'CoinPayments',
    paymentMethod: 'USDT-TRC20',
  });
  // Expired order
  await createOrder({
    id: 'ORD-10800',
    clientId: 'USR-00006',
    planId: 'PLAN-VRZN-30D',
    qty: 1,
    unitPrice: 129,
    region: 'US East',
    status: 'EXPIRED',
    paymentStatus: 'REFUNDED',
    paymentStatusOverride: 'REFUNDED',
    createdAt: past(60),
    activatedAt: past(60),
    expiresAt: past(30),
    paymentProvider: 'Stripe',
    paymentMethod: 'Visa •• 4242',
  });
  // Cancelled order
  await createOrder({
    id: 'ORD-10801',
    clientId: 'USR-00004',
    planId: 'PLAN-ATAT-7D',
    qty: 1,
    unitPrice: 39,
    region: 'US Central',
    status: 'CANCELLED',
    paymentStatus: 'CANCELLED',
    paymentStatusOverride: 'CANCELLED',
    createdAt: past(2),
    cancelledAt: past(1),
    cancelledReason: 'User cancelled before payment',
  });

  // ── WALLET TOP-UPS (for demo user history) ───────────────────────────
  await prisma.payment.create({
    data: {
      id: 'PAY-88999',
      orderId: null,
      clientId: demoUser.id,
      provider: 'Balance',
      method: 'Wallet top-up',
      gross: 100,
      fees: 0,
      net: 100,
      status: 'CONFIRMED',
      confirmedAt: past(7),
      createdAt: past(7),
    },
  });
  await prisma.invoice.create({
    data: { id: 'INV-88999', paymentId: 'PAY-88999', orderId: null, clientId: demoUser.id, amount: 100, createdAt: past(7) },
  });
  await prisma.payment.create({
    data: {
      id: 'PAY-88997',
      orderId: null,
      clientId: demoUser.id,
      provider: 'Balance',
      method: 'Wallet top-up',
      gross: 50,
      fees: 0,
      net: 50,
      status: 'CONFIRMED',
      confirmedAt: past(45),
      createdAt: past(45),
    },
  });

  // Balance ledger backfill
  await prisma.balanceLedgerEntry.createMany({
    data: [
      { userId: demoUser.id, op: 'TOPUP', amount: 50, balanceAfter: 50, refPaymentId: 'PAY-88997', createdAt: past(45) },
      { userId: demoUser.id, op: 'TOPUP', amount: 100, balanceAfter: 150, refPaymentId: 'PAY-88999', createdAt: past(7) },
      { userId: demoUser.id, op: 'MANUAL_ADJUST', amount: 350, balanceAfter: 500, note: 'Welcome credit', createdAt: past(7) },
    ],
  });

  // ── NOTIFICATIONS for demo user ──────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      { id: 'n1', userId: demoUser.id, title: 'Order ORD-10847 expires in 18 days', kind: 'INFO', createdAt: pastHours(1) },
      { id: 'n2', userId: demoUser.id, title: 'Proxy needs attention — degraded performance detected', kind: 'WARNING', createdAt: pastHours(3) },
      { id: 'n3', userId: demoUser.id, title: 'Welcome to HBP — your account is ready', kind: 'SUCCESS', createdAt: past(60) },
    ],
  });

  // ── LOG ENTRIES (a few seeded events for admin Logs page) ────────────
  await prisma.log.createMany({
    data: [
      { actorId: 'ADM-SYS', action: 'ORDER.CREATE',   objectType: 'ORDER',  objectId: 'ORD-10848', detail: 'Order created via client portal · Demo User (USR-00001)', at: pastHours(2) },
      { actorId: 'ADM-SYS', action: 'ORDER.ACTIVATE', objectType: 'ORDER',  objectId: 'ORD-10847', detail: 'Order activated; 6 proxies provisioned from pool Verizon-East-A', at: past(12) },
      { actorId: 'ADM-001', action: 'PAYMENT.CONFIRM',objectType: 'PAYMENT',objectId: 'PAY-10847', detail: 'Stripe payment confirmed · Visa •• 4242 · $774.00', at: past(12) },
      { actorId: 'ADM-002', action: 'PROXY.MARK_FAULTY', objectType: 'PROXY', objectId: 'PXY-30425', detail: 'Marked faulty: connection-loss; auto-replace ON', at: pastHours(8) },
      { actorId: 'ADM-001', action: 'PLAN.UPDATE',    objectType: 'PLAN',   objectId: 'PLAN-ATAT-7D', detail: 'availableQuota: 50 → 60', at: past(2) },
      { actorId: 'ADM-SYS', action: 'CRON.HEALTH_CHECK', objectType: 'SYSTEM', objectId: null, detail: 'Health sweep: 18 healthy · 1 degraded · 1 offline', at: pastHours(1) },
      { actorId: 'ADM-003', action: 'CLIENT.NOTE_ADD',objectType: 'CLIENT', objectId: 'USR-00004', detail: 'Note added: "Followed up on chargeback; user agrees to monitor"', at: past(3) },
      { actorId: 'ADM-001', action: 'AUTH.LOGIN',     objectType: 'AUTH',   objectId: 'ADM-001', detail: 'Admin login from 203.0.113.10', at: pastHours(6) },
    ],
  });

  console.log('✅ Seed complete');
  console.log('   Demo client:  demo@example.com / demo1234');
  console.log('   Super admin:  admin@hbp.local / admin1234');
  console.log('   Ops admin:    ops@hbp.local / admin1234');
  console.log('   Support adm:  support@hbp.local / admin1234');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
