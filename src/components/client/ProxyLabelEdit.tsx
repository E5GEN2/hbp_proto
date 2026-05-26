'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { updateProxyLabelAction } from '@/lib/proxy-actions';

export function ProxyLabelEdit({ proxyId, current }: { proxyId: string; current: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(current ?? '');
  const [pending, start] = useTransition();
  const changed = value !== (current ?? '');

  function save() {
    start(async () => {
      try {
        await updateProxyLabelAction(proxyId, value);
        toast('Label saved', proxyId, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        className="form-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="My label"
        maxLength={40}
        style={{ width: 'auto', flex: 1 }}
      />
      {changed && <button className="btn sm primary" disabled={pending} onClick={save}>{pending ? '…' : 'Save'}</button>}
    </div>
  );
}
