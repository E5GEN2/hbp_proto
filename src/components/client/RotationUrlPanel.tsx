'use client';
import { useToast } from '@/components/ui/Toast';

// Shows the device's real rotation endpoint (Proxy.rotationUrl, set at
// registration). Proxies without one simply don't get the panel.
export function RotationUrlPanel({ rotationUrl }: { rotationUrl: string | null; proxyId?: string }) {
  const toast = useToast();

  async function copy() {
    if (!rotationUrl) return;
    try {
      await navigator.clipboard.writeText(rotationUrl);
      toast('URL copied', '', 'success');
    } catch {
      toast('Copy failed', '', 'danger');
    }
  }

  if (!rotationUrl) return null;
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Rotation URL</span>
      </div>
      <div className="panel-body">
        <div className="creds-row">
          <pre className="export-preview">{rotationUrl}</pre>
          <div className="creds-actions">
            <button className="btn" onClick={copy}>Copy URL</button>
            <button className="btn ghost" disabled title="URL reset ships in a later release">Reset URL</button>
          </div>
        </div>
      </div>
    </div>
  );
}
