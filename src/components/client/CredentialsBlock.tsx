'use client';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';

type Proxy = {
  id: string;
  ip: string;
  port: number;
  username: string;
  password: string;
  rotateToken: string | null;
};

type Protocol = 'http' | 'socks5';
type Format = 'ip-port-user-pass' | 'user-pass-at-ip-port' | 'json' | 'csv';

export function CredentialsBlock({ proxies }: { proxies: Proxy[] }) {
  const toast = useToast();
  const [protocol, setProtocol] = useState<Protocol>('http');
  const [format, setFormat] = useState<Format>('ip-port-user-pass');

  function effPort(p: Proxy) {
    return protocol === 'socks5' ? p.port + 1000 : p.port;
  }

  function line(p: Proxy) {
    const port = effPort(p);
    if (format === 'ip-port-user-pass') return `${p.ip}:${port}:${p.username}:${p.password}`;
    if (format === 'user-pass-at-ip-port') return `${p.username}:${p.password}@${p.ip}:${port}`;
    if (format === 'json') return JSON.stringify({ host: p.ip, port, username: p.username, password: p.password, protocol }, null, 0);
    return `${p.ip},${port},${p.username},${p.password}`;
  }

  const preview = proxies.map(line).join('\n');

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(preview);
      toast('Credentials copied', `${proxies.length} ${proxies.length === 1 ? 'proxy' : 'proxies'} · ${protocol.toUpperCase()}`, 'success');
    } catch {
      toast('Copy failed', 'Use the export field', 'danger');
    }
  }

  return (
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Credentials</span></div>
      <div className="panel-body">
        {/* Protocol toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Protocol</span>
          <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
            <ProtocolTab active={protocol === 'http'} onClick={() => setProtocol('http')} label="HTTP" />
            <ProtocolTab active={protocol === 'socks5'} onClick={() => setProtocol('socks5')} label="SOCKS5" />
          </div>
          {protocol === 'socks5' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>(port +1000)</span>}
        </div>

        {/* Format tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, borderBottom: '1px solid var(--border-subtle)' }}>
          {([
            ['ip-port-user-pass', 'ip:port:user:pass'],
            ['user-pass-at-ip-port', 'user:pass@ip:port'],
            ['json', 'JSON'],
            ['csv', 'CSV'],
          ] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFormat(v)}
              style={{
                padding: '6px 12px', fontSize: 11.5, fontWeight: 500,
                color: format === v ? 'var(--text)' : 'var(--muted)',
                borderBottom: format === v ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}>{l}</button>
          ))}
        </div>

        <pre className="mono" style={{
          margin: 0, padding: 14, background: 'var(--surface-2)',
          borderRadius: 'var(--radius-md)', fontSize: 12,
          lineHeight: 1.6, maxHeight: 240, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>{preview}</pre>

        <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
          <button className="btn primary" onClick={copyAll}>Copy</button>
          <button className="btn" onClick={() => {
            const blob = new Blob([preview], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hbp-proxies-${protocol}-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            toast('Downloaded', `${proxies.length} ${proxies.length === 1 ? 'proxy' : 'proxies'}`, 'success');
          }}>Download</button>
        </div>
      </div>
    </div>
  );
}

function ProtocolTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '6px 14px', fontSize: 11.5,
        background: active ? 'var(--surface)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--muted)',
        borderRadius: 6, fontWeight: 500,
      }}>{label}</button>
  );
}
