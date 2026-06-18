'use client';
import { HelpTip } from './HelpTip';

export function Stage15Badge({ children = 'v1.5' }: { children?: React.ReactNode }) {
  return (
    <HelpTip label="↗">
      <strong>Stage 1.5 feature:</strong> the UI is live but the backend hookup ships in a later release. Per <code>DECISIONS.md</code> in the handoff repo.
    </HelpTip>
  );
}

// Just the inline pill, no tooltip
export function Stage15Pill({ children = 'v1.5' }: { children?: React.ReactNode }) {
  return <span className="stage15-badge">{children}</span>;
}
