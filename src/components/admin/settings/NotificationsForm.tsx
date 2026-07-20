'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { toggleNotificationRuleAction } from '@/lib/ui-actions/settings-actions';
import { fmtAdminStamp } from '@/lib/date';

const CLIENT_RULES = [
  { key: 'order-created',         label: 'Order created → Email receipt' },
  { key: 'payment-confirmed',     label: 'Payment confirmed → Email + Telegram' },
  { key: 'proxy-assigned',        label: 'Proxy assigned → Credentials available in portal' },
  { key: 'pre-renewal-72h',       label: 'Pre-renewal reminder (72h)' },
  { key: 'grace-started',         label: 'Grace period started' },
  { key: 'order-expired-final',   label: 'Order expired (final)' },
  { key: 'replacement-completed', label: 'Proxy replacement completed' },
  { key: 'refund-issued',         label: 'Refund issued' },
];

const ADMIN_RULES = [
  { key: 'admin-new-order',      label: 'New order created' },
  { key: 'admin-payment-failed', label: 'Payment failed / declined' },
  { key: 'admin-proxy-faulty',   label: 'Proxy marked faulty' },
  { key: 'admin-quota-85',       label: 'Plan quota > 85% full' },
  { key: 'admin-chargeback',     label: 'Chargeback received' },
  { key: 'admin-refund-request', label: 'Refund request' },
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
    const next = !(state[key] ?? true);
    setState({ ...state, [key]: next });
    start(async () => {
      try {
        await toggleNotificationRuleAction(key, next);
        router.refresh();
      } catch (e: any) {
        toast('Save failed', e.message, 'warning');
        setState(state);
      }
    });
  }

  const row = (r: { key: string; label: string }) => (
    <div className="form-field" key={r.key}>
      <label className="hstack">
        <span className={`toggle-v2 ${(state[r.key] ?? true) ? 'on' : ''}`} style={{ cursor: pending ? 'wait' : 'pointer' }} onClick={() => toggle(r.key)} />
        <span>{r.label}</span>
      </label>
    </div>
  );

  return (
    <>
      <div className="panel-section">
        <div className="form-grid cols-2">
          {/* Honest-state badges (audit B-4): rule toggles persist, but no email/
              Telegram pipeline exists yet — nothing is actually sent (Phase 2). */}
          <div className="form-field full"><div className="subsection-title">Client notifications <span className="chip muted" style={{ marginLeft: 8, verticalAlign: 'middle' }}>Not wired — Phase 2</span></div></div>
          {CLIENT_RULES.map(row)}

          <div className="form-field full" style={{ marginTop: 10 }}><div className="subsection-title">Admin alerts (Telegram + Email) <span className="chip muted" style={{ marginLeft: 8, verticalAlign: 'middle' }}>Not wired — Phase 2</span></div></div>
          {ADMIN_RULES.map(row)}

          <div className="form-field full" style={{ marginTop: 10 }}><div className="subsection-title">Delivery channels</div></div>
          <div className="form-field"><div className="form-label">Admin email group <span className="req">*</span></div><input className="form-input" placeholder="admins@example.com" disabled /></div>
          <div className="form-field"><div className="form-label">Telegram chat ID <span className="req">*</span></div><input className="form-input" placeholder="-100…" disabled /></div>
          <div className="form-field full"><span className="muted" style={{ fontSize: 11.5 }}>Toggle changes persist immediately but nothing is sent yet — the email/Telegram delivery pipeline ships in Phase 2.</span></div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title-row">
          <span className="panel-title">Reusable templates · {templates.length}<span className="help-tip" data-tip="Pre-written messages an admin can pick from the Send-reminder modal. Group by channel (Email / Telegram). Body supports placeholders like {{client.name}}.">i</span></span>
        </div>
        {templates.length === 0 ? (
          <div className="empty"><div className="empty-desc">No templates yet.</div></div>
        ) : (
          <div className="tpl-list">
            {templates.map(t => {
              const ch = t.channel.toLowerCase();
              return (
                <div className="tpl-row" key={t.id}>
                  <div className="tpl-row-body">
                    <span className="tpl-row-name">{t.name}</span>
                    <span className="tpl-row-meta">{t.id} · {t.trigger.toLowerCase().replace(/_/g, '-')}</span>
                  </div>
                  <span className={`tpl-row-channel ${ch === 'telegram' ? 'telegram' : 'email'}`}>{ch}</span>
                  <span className="tpl-row-meta">{fmtAdminStamp(t.updatedAt)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="panel-section" style={{ padding: '12px 20px 0', border: 'none' }}>
          <span className="muted" style={{ fontSize: 11.5 }}>Templates power the Send-reminder picker. The in-app template editor ships in Phase 2.</span>
        </div>
      </div>
    </>
  );
}
