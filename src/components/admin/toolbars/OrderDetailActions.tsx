'use client';
import { useState } from 'react';
import { AssignProxyModal } from '../modals/AssignProxyModal';

// Canon Order Detail header action: a single "Assign proxies" button (.btn)
// that opens the Assign modal. Candidates load inside the modal on open
// (listAssignCandidatesAction) — no stale page-render prefetch. Add-note
// lives in its own standalone AddNoteToolbar so the page can order header
// actions per canon.
export function OrderDetailActions({
  orderId, qtyNeeded,
}: {
  orderId: string;
  qtyNeeded: number;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setAssignOpen(true)}>Assign proxies</button>
      <AssignProxyModal open={assignOpen} onClose={() => setAssignOpen(false)} orderId={orderId} qtyNeeded={qtyNeeded} />
    </>
  );
}
