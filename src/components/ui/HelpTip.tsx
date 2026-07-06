'use client';

// Canon info-icon (prototype.html .help-tip): a 13px "i" circle carrying the
// tip text in data-tip. The shared TipFloater (mounted once per portal
// layout) opens the body-attached .help-floater on hover — same mechanism
// and visual treatment as .cell-tip truncation tips.
export function HelpTip({ children, label = 'i' }: { children: string; label?: string }) {
  return (
    <span className="help-tip" data-tip={children}>
      {label}
    </span>
  );
}
