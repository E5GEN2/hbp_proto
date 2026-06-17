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
        <span className="panel-title">
          Whitelist <span className="mono" style={{ marginLeft: 6, color: 'var(--muted)' }}>{entries.length}/5</span> <Stage15Pill />
        </span>
        {!full && <button className="panel-action" onClick={() => setOpen(true)}>+ Add IP</button>}
      </div>
      {entries.length === 0 ? (
        <div className="empty" style={{ padding: '24px 20px' }}>
          <div className="empty-desc">No whitelisted IPs. Up to 5 allowed.</div>
        </div>
      ) : (
        <div className="whitelist-list">
          {entries.map(e => (
            <div key={e.id} className="whitelist-row">
              <span className="widget-dot success" />
              <span className="whitelist-ip">{e.ip}</span>
              <button className="row-icon-btn danger" disabled={pending} title="Remove" onClick={() => remove(e.ip)}>
                <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

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
