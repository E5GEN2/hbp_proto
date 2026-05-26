'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Stage15Pill } from '@/components/ui/Stage15Badge';
import { addWhitelistIpAction, removeWhitelistIpAction } from '@/lib/proxy-actions';

export function WhitelistPanel({
  proxyId, entries,
}: { proxyId: string; entries: { id: number; ip: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ip, setIp] = useState('');
  const [pending, start] = useTransition();
  const full = entries.length >= 5;

  function add() {
    start(async () => {
      try {
        await addWhitelistIpAction(proxyId, ip);
        toast('IP whitelisted', ip, 'success');
        setOpen(false);
        setIp('');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  function remove(addr: string) {
    start(async () => {
      try {
        await removeWhitelistIpAction(proxyId, addr);
        toast('IP removed', addr, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Whitelist <Stage15Pill /></span>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{entries.length}/5</span>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {entries.length === 0 ? (
          <div style={{ padding: 20, fontSize: 12.5, color: 'var(--muted)', textAlign: 'center' }}>
            No whitelisted IPs. Up to 5 allowed.
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {entries.map(e => (
              <li key={e.id} style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="mono" style={{ fontSize: 12.5 }}>{e.ip}</span>
                <button className="btn sm" disabled={pending} onClick={() => remove(e.ip)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ padding: 14 }}>
          <button className="btn" disabled={full} onClick={() => setOpen(true)}>{full ? 'Whitelist full' : '+ Add IP'}</button>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add whitelist IP"
        footer={<>
          <button className="btn" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={add} disabled={pending || !ip}>{pending ? '…' : 'Add IP'}</button>
        </>}
      >
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
          When whitelisting is enforced at the gateway, only the IPs you list here will be able to use this proxy.
        </div>
        <label className="form-label">IPv4 address</label>
        <input className="form-input mono" value={ip} onChange={e => setIp(e.target.value)} placeholder="203.0.113.42" autoFocus />
      </Modal>
    </div>
  );
}
