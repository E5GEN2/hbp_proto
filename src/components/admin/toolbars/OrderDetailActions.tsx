'use client';
import { useState } from 'react';
import { AssignProxyModal } from '../modals/AssignProxyModal';
import { AddNoteModal } from '../modals/AddNoteModal';

type ProxyOpt = { id: string; carrier: string; region: string; pool: string; ip: string; port: number; health: string };

export function OrderDetailActions({
  orderId, qtyNeeded, candidates, showAssign,
}: {
  orderId: string;
  qtyNeeded: number;
  candidates: ProxyOpt[];
  showAssign: boolean;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <>
      {showAssign && (
        <button className="btn primary" onClick={() => setAssignOpen(true)}>Assign proxies ({qtyNeeded} needed)</button>
      )}
      <button className="btn" onClick={() => setNoteOpen(true)}>+ Add note</button>
      <AssignProxyModal open={assignOpen} onClose={() => setAssignOpen(false)} orderId={orderId} qtyNeeded={qtyNeeded} candidates={candidates} />
      <AddNoteModal open={noteOpen} onClose={() => setNoteOpen(false)} objectType="ORDER" objectId={orderId} />
    </>
  );
}
