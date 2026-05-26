'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { toggleNotificationRuleAction } from '@/lib/settings-actions';

const CLIENT_RULES = [
  { key: 'order-created',       label: 'Order created' },
  { key: 'payment-confirmed',   label: 'Payment confirmed' },
  { key: 'proxy-assigned',      label: 'Proxy assigned' },
  { key: 'pre-renewal-72h',     label: 'Pre-renewal reminder (72h)' },
  { key: 'grace-started',       label: 'Grace period started' },
  { key: 'order-expired-final', label: 'Order expired (final)' },
  { key: 'replacement-completed', label: 'Replacement completed' },
  { key: 'refund-issued',       label: 'Refund issued' },
];

const ADMIN_RULES = [
  { key: 'admin-new-order',      label: 'New order placed' },
  { key: 'admin-payment-failed', label: 'Payment failed' },
  { key: 'admin-proxy-faulty',   label: 'Proxy marked faulty' },
  { key: 'admin-quota-85',       label: 'Plan quota at 85%' },
  { key: 'admin-chargeback',     label: 'Chargeback' },
  { key: 'admin-refund-request', label: 'Refund requested' },
];

export function NotificationsForm({ initial, templates }: {
  initial: Record<string, boolean>;
  templates: { id: string; name: string; channel: string; trigger: string; updatedAt: Date }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();

  function toggle(key: string) {
    const next = !state[key];
    setState({ ...state, [key]: next });
    start(async () => {
      try {
        await toggleNotificationRuleAction(key, next);
        router.refresh();
      } catch (e: any) {
        toast('Save failed', e.message, 'danger');
        setState(state);
      }
    });
  }

  return (
    <>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Client notifications</div>
      {CLIENT_RULES.map(r => (
        <Row key={r.key} label={r.label} value={state[r.key] ?? true} onChange={() => toggle(r.key)} pending={pending} />
      ))}
      <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginTop: 20, marginBottom: 8 }}>Admin alerts</div>
      {ADMIN_RULES.map(r => (
        <Row key={r.key} label={r.label} value={state[r.key] ?? true} onChange={() => toggle(r.key)} pending={pending} />
      ))}
      <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginTop: 20, marginBottom: 8 }}>Reusable templates ({templates.length})</div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Template</th><th>Channel</th><th>Trigger</th><th>Updated</th></tr></thead>
          <tbody>
            {templates.length === 0
              ? <tr><td colSpan={4}><div className="empty"><div className="empty-desc">No templates yet.</div></div></td></tr>
              : templates.map(t => (
                <tr key={t.id}>
                  <td className="mono td-link">{t.id} · {t.name}</td>
                  <td>{t.channel.toLowerCase()}</td>
                  <td>{t.trigger.toLowerCase().replace(/_/g, '-')}</td>
                  <td>{new Date(t.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--muted)' }}>Template editor ships in the next batch.</div>
    </>
  );
}

function Row({ label, value, onChange, pending }: { label: string; value: boolean; onChange: () => void; pending: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{label}</span>
      <span className={`toggle ${value ? 'on' : ''}`} style={{ cursor: pending ? 'wait' : 'pointer' }} onClick={onChange} />
    </div>
  );
}
