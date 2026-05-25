import { prisma } from './prisma';

async function nextNumericSuffix(prefix: string, table: 'order' | 'payment' | 'invoice' | 'proxy' | 'user' | 'log' | 'notification' | 'assignment' | 'ticket') {
  const map: Record<string, any> = {
    order: prisma.order,
    payment: prisma.payment,
    invoice: prisma.invoice,
    proxy: prisma.proxy,
    user: prisma.user,
    log: prisma.log,
    notification: prisma.notification,
    assignment: prisma.assignment,
    ticket: prisma.ticket,
  };
  const records = await map[table].findMany({
    where: { id: { startsWith: prefix } },
    select: { id: true },
  });
  let max = 0;
  for (const r of records) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

export async function nextOrderId() {
  const n = await nextNumericSuffix('ORD-', 'order');
  return `ORD-${String(n).padStart(5, '0')}`;
}

export async function nextPaymentId() {
  const n = await nextNumericSuffix('PAY-', 'payment');
  return `PAY-${String(n).padStart(5, '0')}`;
}

export async function nextInvoiceId() {
  const n = await nextNumericSuffix('INV-', 'invoice');
  return `INV-${String(n).padStart(5, '0')}`;
}

export async function nextProxyId() {
  const n = await nextNumericSuffix('PXY-', 'proxy');
  return `PXY-${String(n).padStart(5, '0')}`;
}

export async function nextUserId() {
  const n = await nextNumericSuffix('USR-', 'user');
  return `USR-${String(n).padStart(5, '0')}`;
}

export async function nextAssignmentId() {
  const n = await nextNumericSuffix('ASN-', 'assignment');
  return `ASN-${String(n).padStart(5, '0')}`;
}

export async function nextTicketId() {
  const n = await nextNumericSuffix('TCK-', 'ticket');
  return `TCK-${String(n).padStart(5, '0')}`;
}

export function randomPaymentMethodId() {
  return `pm_${Math.random().toString(36).slice(2, 12)}`;
}
