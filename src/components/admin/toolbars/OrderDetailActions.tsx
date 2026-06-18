'use client';
import { useState } from 'react';
import { AssignProxyModal } from '../modals/AssignProxyModal';

type ProxyOpt = { id: string; carrier: string; region: string; pool: string; ip: string; port: number; health: string };

// Canon Order Detail header action: a single "Assign proxy" button (.btn)
// that opens the Assign modal. Add-note lives in its own standalone
// AddNoteToolbar so the page can order header actions per canon.
export function OrderDetailActions({
  orderId, qtyNeeded, candidates,
}: {
  orderId: string;
  qtyNeeded: number;
  candidates: ProxyOpt[];
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setAssignOpen(true)}>Assign proxy</button>
      <AssignProxyModal open={assignOpen} onClose={() => setAssignOpen(false)} orderId={orderId} qtyNeeded={qtyNeeded} candidates={candidates} />
    </>
  );
}
