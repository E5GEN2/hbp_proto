'use client';
import { useState } from 'react';
import { EditClientModal, type EditClientInitial } from '../modals/EditClientModal';
import { AddNoteModal } from '../modals/AddNoteModal';
import { BlockUnblockButton, SetRiskButton } from '../ActionButtons';

export function ClientDetailActions({
  clientId, initial, blocked, risk, carriers, regions,
}: {
  clientId: string;
  initial: EditClientInitial;
  blocked: boolean;
  risk: 'NONE' | 'REVIEW' | 'FLAG';
  carriers: string[];
  regions: string[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setEditOpen(true)}>Edit client</button>
      <SetRiskButton userId={clientId} currentRisk={risk} />
      <button className="btn" onClick={() => setNoteOpen(true)}>Add note</button>
      <BlockUnblockButton userId={clientId} blocked={blocked} />
      <EditClientModal open={editOpen} onClose={() => setEditOpen(false)} clientId={clientId} initial={initial} carriers={carriers} regions={regions} />
      <AddNoteModal open={noteOpen} onClose={() => setNoteOpen(false)} objectType="CLIENT" objectId={clientId} />
    </>
  );
}
