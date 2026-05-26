'use client';
import { useState } from 'react';
import { NewOrderModal } from '../modals/NewOrderModal';

type ClientOpt = { id: string; name: string; email: string; balance: number };
type PlanOpt = { id: string; name: string; price: number; durationDays: number; carrier: string; region: string; available: number };

export function OrdersToolbar({ clients, plans }: { clients: ClientOpt[]; plans: PlanOpt[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>+ New Order</button>
      <NewOrderModal open={open} onClose={() => setOpen(false)} clients={clients} plans={plans} />
    </>
  );
}
