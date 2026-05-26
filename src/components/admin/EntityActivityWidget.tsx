import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { fmtAdminStamp } from '@/lib/date';
import type { LogObjectType } from '@prisma/client';

type Bridge = { type: LogObjectType; id: string };

export async function EntityActivityWidget({
  objectType, objectId, bridges = [],
}: {
  objectType: LogObjectType;
  objectId: string;
  bridges?: Bridge[];
}) {
  // Pull logs for the entity + any cross-bridged entities
  const where = bridges.length > 0
    ? {
        OR: [
          { objectType, objectId },
          ...bridges.map(b => ({ objectType: b.type, objectId: b.id })),
        ],
      }
    : { objectType, objectId };

  const logs = await prisma.log.findMany({
    where,
    orderBy: { at: 'desc' },
    take: 30,
    include: { actor: { select: { name: true, initials: true } } },
  });

  return (
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Activity</span></div>
      <div className="panel-body" style={{ padding: 0 }}>
        {logs.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <div className="empty-desc">No activity yet.</div>
          </div>
        ) : (
          <ul style={{ margin: 0, padding: '12px 0', listStyle: 'none' }}>
            {logs.map((l, i) => {
              const isNote = l.action.endsWith('.NOTE_ADD');
              const tone = isNote ? 'var(--muted)'
                : l.action.includes('.CANCEL') || l.action.includes('FAIL') ? 'var(--danger)'
                : l.action.includes('.CONFIRM') || l.action.includes('.ACTIVATE') || l.action.includes('.CREATE') ? 'var(--success)'
                : l.action.includes('.SUSPEND') || l.action.includes('.MARK_FAULTY') ? 'var(--warning)'
                : 'var(--info)';
              return (
                <li key={l.id} style={{ padding: '8px 20px', position: 'relative', display: 'flex', gap: 12 }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <span style={{ display: 'block', width: 8, height: 8, borderRadius: '50%', background: tone, marginTop: 5 }} />
                    {i < logs.length - 1 && (
                      <span style={{ position: 'absolute', top: 13, left: 3, bottom: -14, width: 2, background: 'var(--border-subtle)' }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{fmtAdminStamp(l.at)}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>
                      {l.action}
                      {l.actor && <span style={{ marginLeft: 6, color: 'var(--muted)', fontWeight: 400 }}>· {l.actor.name}</span>}
                    </div>
                    {l.detail && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>{l.detail}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
