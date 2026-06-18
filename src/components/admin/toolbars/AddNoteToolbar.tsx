'use client';
import { useState } from 'react';
import { AddNoteModal } from '../modals/AddNoteModal';

export function AddNoteToolbar({
  objectType, objectId, label = '+ Add note', as = 'btn',
}: {
  objectType: 'ORDER' | 'PAYMENT' | 'PROXY' | 'CLIENT' | 'PLAN';
  objectId: string;
  label?: string;
  as?: 'btn' | 'panel-action';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {as === 'panel-action'
        ? <span className="panel-action" onClick={() => setOpen(true)}>{label}</span>
        : <button className="btn" onClick={() => setOpen(true)}>{label}</button>}
      <AddNoteModal open={open} onClose={() => setOpen(false)} objectType={objectType} objectId={objectId} />
    </>
  );
}
