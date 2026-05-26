'use client';
import { useToast } from '@/components/ui/Toast';
import { Stage15Pill } from '@/components/ui/Stage15Badge';

export function RotationUrlPanel({ rotateToken, proxyId }: { rotateToken: string | null; proxyId: string }) {
  const toast = useToast();
  const url = rotateToken ? `https://rotate.proxy.io/${rotateToken}` : '';

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast('URL copied', '', 'success');
    } catch {
      toast('Copy failed', '', 'danger');
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Rotation URL <Stage15Pill /></span>
      </div>
      <div className="panel-body">
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
          GET this URL to rotate the proxy IP on-demand. Useful for scripted workflows.
        </div>
        <div style={{
          background: 'var(--surface-2)', padding: '8px 12px', borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text)',
          overflow: 'auto', whiteSpace: 'nowrap', marginBottom: 12,
        }}>{url || '— no token set'}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" disabled={!url} onClick={copy}>Copy URL</button>
          <button className="btn" disabled title="Backend hookup ships in v1.5">Reset URL</button>
        </div>
      </div>
    </div>
  );
}
