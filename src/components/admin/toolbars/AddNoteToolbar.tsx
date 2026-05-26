'use client';
import { useState } from 'react';
import { AddNoteModal } from '../modals/AddNoteModal';

export function AddNoteToolbar({
  objectType, objectId,
}: {
  objectType: 'ORDER' | 'PAYMENT' | 'PROXY' | 'CLIENT' | 'PLAN';
  objectId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>+ Add note</button>
      <AddNoteModal open={open} onClose={() => setOpen(false)} objectType={objectType} objectId={objectId} />
    </>
  );
}
