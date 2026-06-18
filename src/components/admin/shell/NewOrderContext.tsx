'use client';
import { createContext, useContext, useState } from 'react';
import { NewOrderModal } from '@/components/admin/modals/NewOrderModal';

// Canon ships [bell][New Order] as global topbar chrome on every admin page
// (renderRoute() only rebuilds the page-title, never the right rail). To keep
// the New Order modal globally available without a new API route, the admin
// layout fetches the (read-only) client/plan options once and provides them
// here; the GlobalNewOrder button rendered inside every AdminTopbar reads them.
type ClientOpt = { id: string; name: string; email: string; balance: number };
type PlanOpt = { id: string; name: string; price: number; durationDays: number; carrier: string; region: string; available: number };
export type OrderOptions = { clients: ClientOpt[]; plans: PlanOpt[] };

const Ctx = createContext<OrderOptions>({ clients: [], plans: [] });

export function AdminOrderOptionsProvider({ value, children }: { value: OrderOptions; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function GlobalNewOrder() {
  const { clients, plans } = useContext(Ctx);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn primary" type="button" onClick={() => setOpen(true)}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        New Order
      </button>
      <NewOrderModal open={open} onClose={() => setOpen(false)} clients={clients} plans={plans} />
    </>
  );
}
