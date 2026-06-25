import { prisma } from '@/lib/prisma';

// Admin-managed marketing announcement (the nav promo on /marketing).
// Stored in SystemSetting key 'marketing.announcement' as JSON — no schema migration.
// Single editable banner + on/off (per product decision 2026-06-25).

export const ANNOUNCEMENT_KEY = 'marketing.announcement';

export type AnnouncementVariant = 'promo' | 'info' | 'warning';

export type Announcement = {
  enabled: boolean;
  text: string;
  href: string;
  variant: AnnouncementVariant;
};

// Default reproduces the design's nav promo verbatim.
export const DEFAULT_ANNOUNCEMENT: Announcement = {
  enabled: true,
  text: '10% off the 90‑days plan',
  href: '#plans',
  variant: 'promo',
};

// Normalize a raw SystemSetting JSON value (or anything) into a valid Announcement,
// falling back to the design default per field. Shared by the marketing page (read)
// and the admin settings page (initial form state).
export function coerceAnnouncement(value: unknown): Announcement {
  const v = (value ?? {}) as Partial<Announcement>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_ANNOUNCEMENT.enabled,
    text: typeof v.text === 'string' ? v.text : DEFAULT_ANNOUNCEMENT.text,
    href: typeof v.href === 'string' ? v.href : DEFAULT_ANNOUNCEMENT.href,
    variant: (['promo', 'info', 'warning'] as const).includes(v.variant as AnnouncementVariant)
      ? (v.variant as AnnouncementVariant)
      : DEFAULT_ANNOUNCEMENT.variant,
  };
}

export async function getAnnouncement(): Promise<Announcement> {
  const row = await prisma.systemSetting.findUnique({ where: { key: ANNOUNCEMENT_KEY } });
  return coerceAnnouncement(row?.value);
}

const VARIANT_COLOR: Record<AnnouncementVariant, string> = {
  promo: 'rgb(94, 120, 166)', // design default (slate-deep blue)
  info: '#1F2A3F',
  warning: '#856330',
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Renders the `.nav__promo` markup (matches the design). Empty string when disabled
// or text is blank, so the promo simply disappears from the nav.
export function renderPromoHtml(a: Announcement): string {
  if (!a.enabled || !a.text.trim()) return '';
  const href = a.href.trim() || '#plans';
  return (
    `<a class="nav__promo" href="${esc(href)}">` +
    `<span style="color: ${VARIANT_COLOR[a.variant]}; font-weight: 600">${esc(a.text)}</span>` +
    `<span class="arr">→</span>` +
    `</a>`
  );
}
