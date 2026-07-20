// Invoice PDF generation (audit B-8, admin-only surface). pdf-lib is pure JS —
// no native deps, safe in the Next server runtime. Standard Helvetica fonts:
// invoice content is ASCII/English by design.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Prisma } from '@prisma/client';
import { appUrl } from './app-url';
import { money2dp } from './money';

export type InvoiceWithRelations = Prisma.InvoiceGetPayload<{
  include: { payment: true; order: { include: { plan: true } }; client: true };
}>;

const INK = rgb(0.039, 0.059, 0.114);   // #0A0F1D
const GOLD = rgb(0.71, 0.541, 0.29);    // #B58A4A
const MUTED = rgb(0.42, 0.4, 0.36);
const LINE = rgb(0.88, 0.86, 0.82);

// Ledger-grade document — always 2dp, now with en-US grouping (P1-5).
const money = (n: number) => money2dp(n);
const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

export async function buildInvoicePdf(inv: InvoiceWithRelations): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const left = 56;
  const right = 595.28 - 56;
  let y = 841.89 - 64;

  // ── Header: wordmark + INVOICE ────────────────────────────────────────────
  page.drawText('COMET', { x: left, y, size: 18, font: bold, color: INK });
  page.drawText('PROXY', { x: left + bold.widthOfTextAtSize('COMET', 18) + 6, y, size: 18, font: bold, color: GOLD });
  const title = 'INVOICE';
  page.drawText(title, { x: right - bold.widthOfTextAtSize(title, 20), y, size: 20, font: bold, color: INK });

  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1.2, color: GOLD });

  // ── Meta block (left) + Billed to (right) ────────────────────────────────
  y -= 30;
  const metaTop = y;
  const meta: [string, string][] = [
    ['Invoice no.', inv.id],
    ['Issue date', fmtDate(inv.createdAt)],
    ['Payment', inv.payment.id],
    ['Method', `${inv.payment.provider} · ${inv.payment.method}`],
    ['Payment status', inv.payment.status.charAt(0) + inv.payment.status.slice(1).toLowerCase()],
  ];
  for (const [k, v] of meta) {
    page.drawText(k, { x: left, y, size: 9, font, color: MUTED });
    page.drawText(v, { x: left + 90, y, size: 9.5, font: bold, color: INK });
    y -= 16;
  }

  let yr = metaTop;
  page.drawText('BILLED TO', { x: 340, y: yr, size: 8.5, font: bold, color: MUTED });
  yr -= 16;
  page.drawText(inv.client.name, { x: 340, y: yr, size: 10.5, font: bold, color: INK });
  yr -= 15;
  page.drawText(inv.client.email, { x: 340, y: yr, size: 9.5, font, color: INK });
  yr -= 15;
  page.drawText(`Account ${inv.client.id}`, { x: 340, y: yr, size: 9, font, color: MUTED });

  // ── Line item table ──────────────────────────────────────────────────────
  y = Math.min(y, yr) - 36;
  page.drawText('DESCRIPTION', { x: left, y, size: 8.5, font: bold, color: MUTED });
  page.drawText('AMOUNT', { x: right - bold.widthOfTextAtSize('AMOUNT', 8.5), y, size: 8.5, font: bold, color: MUTED });
  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.7, color: LINE });

  const description = inv.order
    ? `${inv.order.plan.name} — ${inv.order.qty} × ${inv.order.plan.durationDays}-day mobile proxy (order ${inv.order.id})`
    : 'Account balance top-up';
  const amount = Number(inv.amount);

  y -= 20;
  page.drawText(description, { x: left, y, size: 10, font, color: INK, maxWidth: 380 });
  page.drawText(money(amount), { x: right - font.widthOfTextAtSize(money(amount), 10), y, size: 10, font, color: INK });
  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.7, color: LINE });

  // ── Totals ───────────────────────────────────────────────────────────────
  const fees = Number(inv.payment.fees);
  y -= 22;
  if (fees > 0) {
    page.drawText('Processing fees (included)', { x: 340, y, size: 9, font, color: MUTED });
    page.drawText(money(fees), { x: right - font.widthOfTextAtSize(money(fees), 9), y, size: 9, font, color: MUTED });
    y -= 18;
  }
  page.drawText('TOTAL', { x: 340, y, size: 11, font: bold, color: INK });
  page.drawText(money(amount), { x: right - bold.widthOfTextAtSize(money(amount), 12), y, size: 12, font: bold, color: GOLD });

  // ── Refund note (paper trail stays honest) ───────────────────────────────
  if (inv.payment.status === 'REFUNDED') {
    y -= 24;
    const refunded = Number(inv.payment.refundedAmount ?? inv.payment.gross);
    const note = `Refunded ${money(refunded)}${inv.payment.refundedAt ? ` on ${fmtDate(inv.payment.refundedAt)}` : ''}`;
    page.drawText(note, { x: 340, y, size: 9, font: bold, color: rgb(0.7, 0.25, 0.25) });
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  const footY = 72;
  page.drawLine({ start: { x: left, y: footY + 18 }, end: { x: right, y: footY + 18 }, thickness: 0.7, color: LINE });
  page.drawText(`Comet Proxy · ${appUrl().replace(/^https?:\/\//, '')} · Telegram @US5Gwetrust`, {
    x: left, y: footY, size: 8.5, font, color: MUTED,
  });
  page.drawText('Generated from the admin panel', {
    x: right - font.widthOfTextAtSize('Generated from the admin panel', 8.5), y: footY, size: 8.5, font, color: MUTED,
  });

  return doc.save();
}
