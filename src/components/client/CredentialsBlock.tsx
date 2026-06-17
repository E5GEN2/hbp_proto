'use client';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';

type Proxy = {
  id: string;
  ip: string;
  port: number;
  username: string;
  password: string;
  carrier: string;
  region: string;
  rotateToken: string | null;
};

type Protocol = 'http' | 'socks5';
type Format = 'ip:port:user:pass' | 'user:pass@ip:port' | 'json' | 'csv';

const FORMATS: { key: Format; label: string }[] = [
  { key: 'ip:port:user:pass', label: 'ip:port:user:pass' },
  { key: 'user:pass@ip:port', label: 'user:pass@ip:port' },
  { key: 'json', label: 'JSON' },
  { key: 'csv', label: 'CSV' },
];

// Mirrors the canon formatProxiesExport (proto:// prefix on the string forms).
function formatExport(proxies: Proxy[], format: Format, proto: Protocol): string {
  const portOf = (p: Proxy) => (proto === 'socks5' ? p.port + 1000 : p.port);
  if (format === 'ip:port:user:pass') return proxies.map(p => `${proto}://${p.ip}:${portOf(p)}:${p.username}:${p.password}`).join('\n');
  if (format === 'user:pass@ip:port') return proxies.map(p => `${proto}://${p.username}:${p.password}@${p.ip}:${portOf(p)}`).join('\n');
  if (format === 'json') return JSON.stringify(proxies.map(p => ({ id: p.id, protocol: proto, ip: p.ip, port: portOf(p), username: p.username, password: p.password, carrier: p.carrier, region: p.region })), null, 2);
  return ['id,protocol,ip,port,username,password,carrier,region']
    .concat(proxies.map(p => [p.id, proto, p.ip, portOf(p), p.username, p.password, p.carrier, p.region].join(',')))
    .join('\n');
}

export function CredentialsBlock({ proxies }: { proxies: Proxy[] }) {
  const toast = useToast();
  const [protocol, setProtocol] = useState<Protocol>('http');
  const [format, setFormat] = useState<Format>('ip:port:user:pass');

  const preview = formatExport(proxies, format, protocol);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(preview);
      toast('Credentials copied', `${proxies.length} ${proxies.length === 1 ? 'proxy' : 'proxies'} · ${protocol.toUpperCase()}`, 'success');
    } catch {
      toast('Copy failed', 'Select and copy manually', 'danger');
    }
  }

  return (
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Credentials</span></div>
      <div className="panel-body">
        <div className="export-row">
          <span className="export-label">Protocol</span>
          <div className="export-proto-group">
            <button className={`export-proto ${protocol === 'http' ? 'active' : ''}`} onClick={() => setProtocol('http')}>HTTP</button>
            <button className={`export-proto ${protocol === 'socks5' ? 'active' : ''}`} onClick={() => setProtocol('socks5')}>SOCKS5</button>
          </div>
        </div>
        <div className="export-row">
          <span className="export-label">Format</span>
          <div className="export-tabs">
            {FORMATS.map(f => (
              <div key={f.key} className={`export-tab ${format === f.key ? 'active' : ''}`} onClick={() => setFormat(f.key)}>{f.label}</div>
            ))}
          </div>
        </div>
        <div className="creds-row">
          <pre className="export-preview">{preview}</pre>
          <div className="creds-actions">
            <button className="btn" onClick={copyAll}>Copy</button>
            <button className="btn ghost" disabled title="Password reset ships in a later release">Reset password</button>
          </div>
        </div>
      </div>
    </div>
  );
}
