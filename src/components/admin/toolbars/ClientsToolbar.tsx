'use client';
import { useState } from 'react';
import { NewClientModal } from '../modals/NewClientModal';

export function ClientsToolbar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>+ New Client</button>
      <NewClientModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
