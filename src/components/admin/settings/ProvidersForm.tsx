'use client';
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { setProviderEnabledAction } from '@/lib/ui-actions/settings-actions';

type ProviderCfg = {
  enabled: boolean;
  accountId?: string; publishableKey?: string; webhookSecret?: string;
  confirmations?: number; currencies?: string[];
};

export function ProvidersForm({ initial }: {
  initial: { stripe?: ProviderCfg; crypto?: ProviderCfg; bank?: ProviderCfg; paypal?: ProviderCfg };
}) {
  return (
    <div className="form-grid">
      <ProviderCard
        name="Stripe" desc="Primary card processor · Live mode" provider="stripe"
        cfg={initial.stripe ?? { enabled: false }}
        impact={[
          'New card checkouts blocked immediately',
          'Auto-renew via card pauses',
          'Crypto and bank-transfer providers continue working',
          'Re-enable from this same screen',
        ]}
        fields={[
          { name: 'accountId', label: 'Account ID' },
          { name: 'publishableKey', label: 'Publishable key' },
          { name: 'webhookSecret', label: 'Webhook secret', secret: true },
        ]}
        cols={3}
      />
      <ProviderCard
        name="Crypto (NOWPayments)" desc="USDT (TRC20 / ERC20), USDC, BTC" provider="crypto"
        cfg={initial.crypto ?? { enabled: false }}
        impact={['New crypto checkouts blocked', 'Pending crypto invoices unaffected', 'Card and bank-transfer providers continue']}
        fields={[
          { name: 'confirmations', label: 'Confirmations required (USDT)' },
          { name: 'currencies', label: 'Accepted currencies' },
        ]}
        cols={2}
      />
      <ProviderCard
        name="Bank transfer (invoice)" desc="Manual confirmation by Ops" provider="bank"
        cfg={initial.bank ?? { enabled: false }}
        impact={['New invoice checkouts blocked', 'In-flight invoices unaffected', 'Card and crypto providers continue']}
        fields={[]} cols={2} activeLabel="Active"
      />

      <div className="provider-card disconnected">
        <div className="hstack between">
          <div className="vstack">
            <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--text)' }}>PayPal</span>
            <span className="muted">Not connected · OAuth connect ships in Phase 2</span>
          </div>
        </div>
      </div>

      <div className="form-field full"><span className="muted" style={{ fontSize: 11.5 }}>Enable / disable persists immediately. Editing provider credentials is gated to Super Admin in production (Phase 2 RBAC).</span></div>
    </div>
  );
}

function ProviderCard({ name, desc, provider, cfg, fields, impact, cols, activeLabel = 'Connected' }: {
  name: string; desc: string;
  provider: 'stripe' | 'crypto' | 'bank';
  cfg: ProviderCfg;
  fields: { name: string; label: string; secret?: boolean }[];
  impact: string[];
  cols: 2 | 3;
  activeLabel?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function flip() {
    if (cfg.enabled && impact.length > 0) { setConfirmOpen(true); return; }
    doFlip(!cfg.enabled);
  }
  function doFlip(toOn: boolean) {
    start(async () => {
      try {
        await setProviderEnabledAction(provider, toOn);
        toast(`${name} ${toOn ? 'enabled' : 'disabled'}`, '', toOn ? 'success' : 'warning');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'warning'); }
    });
  }

  return (
    <div className="provider-card">
      <div className="hstack between">
        <div className="vstack">
          <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--text)' }}>{name}</span>
          <span className="muted">{desc}</span>
        </div>
        <div className="hstack">
          <span className={`chip ${cfg.enabled ? (activeLabel === 'Active' ? 'active' : 'paid') : 'muted'} sm`}>{cfg.enabled ? activeLabel : 'Disabled'}</span>
          <span className={`toggle-v2 ${cfg.enabled ? 'on' : ''}`} style={{ cursor: pending ? 'wait' : 'pointer' }} onClick={flip} />
        </div>
      </div>
      {cfg.enabled && fields.length > 0 && (
        <div className={`form-grid cols-${cols}`} style={{ padding: '14px 0 0' }}>
          {fields.map(f => {
            const raw = (cfg as any)[f.name];
            const val = Array.isArray(raw) ? raw.join(', ') : raw ?? '';
            return (
              <div className="form-field" key={f.name}>
                <div className="form-label">{f.label}</div>
                <input className="form-input" type={f.secret ? 'password' : 'text'} defaultValue={String(val)} disabled />
              </div>
            );
          })}
        </div>
      )}
      <ConfirmAction
        open={confirmOpen} onClose={() => setConfirmOpen(false)}
        title={`Disable ${name}?`} entityLabel={`Provider · ${name}`}
        message="This affects the client portal immediately."
        impact={impact} requireReason confirmLabel={`Disable ${name}`} confirmTone="danger"
        onConfirm={async () => { setConfirmOpen(false); doFlip(false); }}
      />
    </div>
  );
}
