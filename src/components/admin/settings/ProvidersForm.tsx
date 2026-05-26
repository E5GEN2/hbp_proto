'use client';
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { setProviderEnabledAction } from '@/lib/settings-actions';

type ProviderCfg = {
  enabled: boolean;
  accountId?: string;
  publishableKey?: string;
  webhookSecret?: string;
  confirmations?: number;
  currencies?: string[];
};

export function ProvidersForm({ initial }: {
  initial: { stripe?: ProviderCfg; crypto?: ProviderCfg; bank?: ProviderCfg; paypal?: ProviderCfg };
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
      <ProviderCard
        name="Stripe" provider="stripe" initial={initial.stripe ?? { enabled: false }}
        impactWhenDisabling={[
          'The client portal will stop accepting card payments',
          'Existing subscriptions / auto-renews on cards stop being charged',
          'Crypto and bank-transfer providers continue working',
          'Re-enable from this same screen',
        ]}
        fields={[
          { name: 'accountId', label: 'Account ID' },
          { name: 'publishableKey', label: 'Publishable key' },
          { name: 'webhookSecret', label: 'Webhook signing secret' },
        ]}
      />
      <ProviderCard
        name="CoinPayments (crypto)" provider="crypto" initial={initial.crypto ?? { enabled: false }}
        impactWhenDisabling={[
          'New crypto checkouts blocked',
          'Pending crypto invoices unaffected',
          'Card and bank-transfer providers continue',
        ]}
        fields={[
          { name: 'confirmations', label: 'Confirmations required', kind: 'number' },
        ]}
      />
      <ProviderCard
        name="Bank transfer" provider="bank" initial={initial.bank ?? { enabled: false }}
        impactWhenDisabling={[
          'Clients can no longer pay by invoice / wire',
          'In-flight invoices keep their existing payment window',
        ]}
        fields={[]}
      />
      <ProviderCard
        name="PayPal" provider="paypal" initial={initial.paypal ?? { enabled: false }}
        impactWhenDisabling={[]}
        fields={[]}
      />
    </div>
  );
}

function ProviderCard({
  name, provider, initial, fields, impactWhenDisabling,
}: {
  name: string; provider: 'stripe' | 'crypto' | 'bank' | 'paypal';
  initial: ProviderCfg;
  fields: { name: string; label: string; kind?: 'text' | 'number' }[];
  impactWhenDisabling: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function flip(toOn: boolean) {
    if (!toOn && impactWhenDisabling.length > 0) {
      setConfirmOpen(true);
      return;
    }
    doFlip(toOn);
  }
  function doFlip(toOn: boolean) {
    start(async () => {
      try {
        await setProviderEnabledAction(provider, toOn);
        toast(`${name} ${toOn ? 'enabled' : 'disabled'}`, '', toOn ? 'success' : 'warning');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`chip ${initial.enabled ? 'success' : 'muted'} sm`}>{initial.enabled ? 'Connected' : 'Disabled'}</span>
          <span className={`toggle ${initial.enabled ? 'on' : ''}`} style={{ cursor: pending ? 'wait' : 'pointer' }} onClick={() => flip(!initial.enabled)} />
        </div>
      </div>
      {fields.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginTop: 12 }}>
          {fields.map(f => (
            <div key={f.name}>
              <label className="form-label">{f.label}</label>
              <input className="form-input mono" type={f.kind === 'number' ? 'number' : 'text'} defaultValue={String((initial as any)[f.name] ?? '')} disabled />
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Editing provider credentials is gated to Super Admin in production (Phase 2 RBAC).</div>
        </div>
      )}
      <ConfirmAction
        open={confirmOpen} onClose={() => setConfirmOpen(false)}
        title={`Disable ${name}?`}
        entityLabel={`Provider · ${name}`}
        message={`This affects the client portal immediately.`}
        impact={impactWhenDisabling}
        requireReason
        confirmLabel={`Disable ${name}`}
        confirmTone="danger"
        onConfirm={async () => doFlip(false)}
      />
    </div>
  );
}
