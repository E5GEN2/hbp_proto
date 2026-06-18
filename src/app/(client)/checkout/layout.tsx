import { TelegramCta } from '@/components/client/TelegramCta';

// Checkout-scoped layout: renders the floating Telegram help CTA across
// every checkout sub-state (order, deposit, resume) without per-page wiring.
// Canon scopes this with body[data-current-route="checkout"]; here the route
// segment does the scoping.
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <TelegramCta />
    </>
  );
}
