'use client';
import { FormSelect } from '@/components/ui/FormSelect';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { setTimeFormatAction } from '@/lib/ui-actions/settings-actions';

export function DisplayForm({ initial }: { initial: { timeFormat: 'UTC' | 'GMT' } }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [fmt, setFmt] = useState<string>(initial.timeFormat);

  function set(v: string) {
    if (v === initial.timeFormat) return;
    start(async () => {
      try {
        await setTimeFormatAction(v as 'UTC' | 'GMT');
        toast('Time format updated', v, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'warning'); }
    });
  }

  return (
    <div className="form-grid cols-2">
      <div className="form-field full"><div className="subsection-title">Time</div></div>
      <div className="form-field">
        <div className="form-label">Time format<span className="help-tip" data-tip="Label suffix for the sidebar clock. UTC and GMT share zero offset; label preference only.">i</span></div>
        <FormSelect
          value={fmt}
          disabled={pending}
          onChange={v => { setFmt(v); set(v); }}
          placeholder={null}
          options={[
            { value: 'UTC', label: 'UTC — Coordinated Universal Time' },
            { value: 'GMT', label: 'GMT — Greenwich Mean Time' },
          ]}
        />
      </div>
      <div className="form-field">
        <div className="form-label">Live clock</div>
        <input className="form-input" value="Sidebar header · always visible" disabled />
      </div>

      <div className="form-field full" style={{ marginTop: 10 }}><div className="subsection-title">Future preferences</div></div>
      <div className="form-field full">
        <span className="muted" style={{ fontSize: 12 }}>Theme, density, table row height, sidebar width — to be added as the system evolves. Both UTC and GMT share zero offset; the label is cosmetic.</span>
      </div>
    </div>
  );
}
