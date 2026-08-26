import Link from 'next/link';
import type { OrderSignalChip } from '@/lib/order-signals';

// The one renderer for the time-horizon chip (status revision): identical
// label/tone/destination on every admin surface. `clip` = table cells — the
// canon cell-tip machinery, with the tooltip carrying label + boundary since
// the clipped chip may hide both; default = header/panel context, where the
// label is fully visible and a native title carries just the boundary.
// No 'use client': pure presentational, imported by server pages and the
// client-side bulk tables alike.
export function SignalChip({ chip, clip = false }: { chip: OrderSignalChip; clip?: boolean }) {
  if (clip) {
    return (
      <Link
        href={chip.href}
        className={`chip ${chip.tone} cell-tip chip-clip`}
        data-tip={chip.tip ? `${chip.label} — ${chip.tip}` : chip.label}
      >{chip.label}</Link>
    );
  }
  return <Link href={chip.href} className={`chip ${chip.tone}`} title={chip.tip ?? undefined}>{chip.label}</Link>;
}
