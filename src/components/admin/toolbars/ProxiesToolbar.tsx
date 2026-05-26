'use client';
import { useState } from 'react';
import { RegisterProxyModal } from '../modals/RegisterProxyModal';

export function ProxiesToolbar({ carriers, regions, pools }: { carriers: string[]; regions: string[]; pools: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>+ Register proxy</button>
      <RegisterProxyModal open={open} onClose={() => setOpen(false)} carriers={carriers} regions={regions} pools={pools} />
    </>
  );
}
