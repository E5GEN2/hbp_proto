import Link from 'next/link';
import type { OrderSignalChip } from '@/lib/order-signals';

// The one renderer for the time-horizon chip (status revision): identical
// label/tone/destination on every admin surface. `clip` = table cells;
// default = header/panel context, where the label is fully visible and a
// native title carries just the boundary.
// Clip mode picks its tooltip channel by payload (review find): a chip with a
// boundary tip must NOT ride .cell-tip — TipFloater gates .cell-tip on actual
// clipping, so a fitting label would make the boundary unreachable. Bare
// [data-tip] tips unconditionally (the .chip.chip-clip rule keeps the same
// clip geometry); a chip with no extra info (renewed) keeps the canon
// cell-tip clip-gate like its table neighbours.
// No 'use client': pure presentational, imported by server pages and the
// client-side bulk tables alike.
export function SignalChip({ chip, clip = false }: { chip: OrderSignalChip; clip?: boolean }) {
  if (clip) {
    return chip.tip ? (
      <Link
        href={chip.href}
        className={`chip ${chip.tone} chip-clip`}
        data-tip={`${chip.label} — ${chip.tip}`}
      >{chip.label}</Link>
    ) : (
      <Link
        href={chip.href}
        className={`chip ${chip.tone} cell-tip chip-clip`}
        data-tip={chip.label}
      >{chip.label}</Link>
    );
  }
  return <Link href={chip.href} className={`chip ${chip.tone}`} title={chip.tip ?? undefined}>{chip.label}</Link>;
}
