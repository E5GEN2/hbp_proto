'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { setTimeFormatAction } from '@/lib/settings-actions';

export function DisplayForm({ initial }: { initial: { timeFormat: 'UTC' | 'GMT' } }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function set(v: 'UTC' | 'GMT') {
    if (v === initial.timeFormat) return;
    start(async () => {
      try {
        await setTimeFormatAction(v);
        toast('Time format updated', v, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="form-label">Time format</label>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', width: 'max-content' }}>
        {(['UTC', 'GMT'] as const).map(v => (
          <button key={v} onClick={() => set(v)} disabled={pending}
            style={{
              padding: '8px 18px', fontSize: 12.5, fontWeight: 500,
              background: initial.timeFormat === v ? 'var(--surface)' : 'transparent',
              color: initial.timeFormat === v ? 'var(--text)' : 'var(--muted)',
              borderRadius: 6,
            }}>{v}</button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
        Both UTC and GMT have zero offset. The label is cosmetic — choose whichever your team uses internally.
      </div>
    </div>
  );
}
