'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { updateAutoRotateAction } from '@/lib/proxy-actions';

// Stage 1.5 backend per IMPLEMENTATION_BACKLOG.md S4: the plan declares
// `rotation_policies_allowed[]` and `auto_interval_min_choices[]`. Until those
// fields are on Plan, we use a sensible default set matching the prototype seed:
// 0 = manual/URL-only, otherwise minutes (5/10/30/60/240).
const CHOICES = [
  { value: 0,   label: 'Manual (URL-only)' },
  { value: 5,   label: 'Every 5 min' },
  { value: 10,  label: 'Every 10 min' },
  { value: 30,  label: 'Every 30 min' },
  { value: 60,  label: 'Every 1 hour' },
  { value: 240, label: 'Every 4 hours' },
];

export function AutoRotationPicker({ proxyId, current }: { proxyId: string; current: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(current);

  function save(next: number) {
    setValue(next);
    start(async () => {
      try {
        await updateAutoRotateAction(proxyId, next);
        toast('Rotation policy saved', next === 0 ? 'Manual / URL-only' : `Every ${next} min`, 'success');
        router.refresh();
      } catch (e: any) {
        toast('Save failed', e.message, 'danger');
        setValue(current);
      }
    });
  }

  return (
    <select
      className="form-select"
      value={value}
      disabled={pending}
      onChange={e => save(parseInt(e.target.value, 10))}
      style={{ minWidth: 0, width: 'auto', padding: '4px 8px', fontSize: 12, lineHeight: 1.4 }}
    >
      {CHOICES.map(c => (
        <option key={c.value} value={c.value}>{c.label}</option>
      ))}
    </select>
  );
}
