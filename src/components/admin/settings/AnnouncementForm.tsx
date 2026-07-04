'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { saveAnnouncementAction } from '@/lib/ui-actions/settings-actions';
import type { Announcement, AnnouncementVariant } from '@/lib/announcement';

const PREVIEW_COLOR: Record<AnnouncementVariant, string> = {
  promo: 'rgb(94, 120, 166)',
  info: '#1F2A3F',
  warning: '#856330',
};

// Admin control for the marketing site's top promo (the nav announcement on /marketing).
// Single editable banner + on/off; persisted to SystemSetting via saveAnnouncementAction.
export function AnnouncementForm({ initial }: { initial: Announcement }) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState<Announcement>(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  function save() {
    start(async () => {
      try {
        await saveAnnouncementAction(s);
        toast(
          'Announcement saved',
          s.enabled && s.text.trim() ? 'Live on the marketing site' : 'Hidden from the marketing site',
          'success',
        );
        router.refresh();
      } catch (e: any) {
        toast('Save failed', e.message, 'warning');
      }
    });
  }

  return (
    <div className="form-grid cols-2">
      <div className="form-field full"><div className="subsection-title">Marketing site promo</div></div>

      <div className="form-field">
        <label className="hstack">
          <span
            className={`toggle-v2 ${s.enabled ? 'on' : ''}`}
            style={{ cursor: pending ? 'wait' : 'pointer' }}
            onClick={() => setS({ ...s, enabled: !s.enabled })}
          />
          <span>Show promo in the site nav</span>
        </label>
      </div>
      <div className="form-field">
        <div className="form-label">Style</div>
        <select
          className="form-select"
          value={s.variant}
          onChange={(e) => setS({ ...s, variant: e.target.value as AnnouncementVariant })}
        >
          <option value="promo">Promo (blue)</option>
          <option value="info">Info (neutral)</option>
          <option value="warning">Highlight (gold)</option>
        </select>
      </div>

      <div className="form-field full">
        <div className="form-label">Message</div>
        <input
          className="form-input"
          value={s.text}
          maxLength={200}
          placeholder="10% off the 90-days plan"
          onChange={(e) => setS({ ...s, text: e.target.value })}
        />
      </div>
      <div className="form-field full">
        <div className="form-label">Link <span className="muted">(optional — e.g. #plans or /checkout?duration=90)</span></div>
        <input
          className="form-input"
          value={s.href}
          maxLength={300}
          placeholder="#plans"
          onChange={(e) => setS({ ...s, href: e.target.value })}
        />
      </div>

      <div className="form-field full">
        <div className="form-label">Preview</div>
        <div style={{ display: 'flex', alignItems: 'center', minHeight: 28 }}>
          {s.enabled && s.text.trim() ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: PREVIEW_COLOR[s.variant] }} />
              <b style={{ color: PREVIEW_COLOR[s.variant], fontWeight: 600 }}>{s.text}</b>
              <span style={{ color: 'var(--muted)' }}>→</span>
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>Hidden — the promo won’t appear on the site.</span>
          )}
        </div>
      </div>

      <div className="form-actions-row">
        <button className="btn primary" disabled={pending || !dirty} onClick={save}>
          {pending ? 'Saving…' : 'Save announcement'}
        </button>
      </div>
    </div>
  );
}
