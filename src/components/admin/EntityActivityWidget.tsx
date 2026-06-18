import { prisma } from '@/lib/prisma';
import { fmtAdminStamp } from '@/lib/date';
import type { LogObjectType } from '@prisma/client';

type Bridge = { type: LogObjectType; id: string };

// Canon Activity widget — right-aside vertical timeline (`.tl-item`).
// Same shape on every detail page. Shows the latest 30 events; the
// timeline caps at ~5 rows and scrolls (`.activity-scroll`).
function dotClass(action: string): string {
  if (action.endsWith('.NOTE_ADD')) return 'muted';
  if (action.includes('.CANCEL') || action.includes('FAIL')) return 'danger';
  if (action.includes('.CONFIRM') || action.includes('.ACTIVATE') || action.includes('.CREATE')) return 'success';
  if (action.includes('.SUSPEND') || action.includes('.MARK_FAULTY')) return 'warn';
  return 'accent';
}

function titleFor(action: string): string {
  return action.toLowerCase().replace(/[._]/g, ' ');
}

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
    include: { actor: { select: { name: true } } },
  });

  return (
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Activity</span></div>
      {logs.length === 0 ? (
        <div className="muted" style={{ padding: '18px 20px', fontSize: 12 }}>No activity yet.</div>
      ) : (
        <div className="timeline activity-scroll" style={{ padding: '14px 18px' }}>
          {logs.map(l => (
            <div key={l.id} className="tl-item">
              <span className={`tl-dot ${dotClass(l.action)}`} />
              <div className="tl-body">
                <span className="tl-title">{titleFor(l.action)}</span>
                <span className="tl-meta">{fmtAdminStamp(l.at)} · {l.actor?.name ?? '—'}</span>
                {l.detail && <span className="tl-meta">{l.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
