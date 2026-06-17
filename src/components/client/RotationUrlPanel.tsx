'use client';
import { useToast } from '@/components/ui/Toast';
import { Stage15Pill } from '@/components/ui/Stage15Badge';

export function RotationUrlPanel({ rotateToken }: { rotateToken: string | null; proxyId?: string }) {
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
        <div className="creds-row">
          <pre className="export-preview">{url || '— no token set'}</pre>
          <div className="creds-actions">
            <button className="btn" disabled={!url} onClick={copy}>Copy URL</button>
            <button className="btn ghost" disabled title="URL reset ships in a later release">Reset URL</button>
          </div>
        </div>
      </div>
    </div>
  );
}
