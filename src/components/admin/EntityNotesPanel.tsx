import { prisma } from '@/lib/prisma';
import { fmtAdminStamp } from '@/lib/date';
import type { NoteObjectType } from '@prisma/client';
import { AddNoteToolbar } from './toolbars/AddNoteToolbar';

// Canon Notes panel — admin-authored notes only (NOTE_ADD). Lifecycle /
// system events live in the Activity widget. Uses the canonical
// `.activity-list` / `.activity-row` markup shared across detail pages.
export async function EntityNotesPanel({
  objectType, objectId,
}: { objectType: NoteObjectType; objectId: string }) {
  const notes = await prisma.entityNote.findMany({
    where: { objectType, objectId },
    orderBy: { createdAt: 'desc' },
    take: 12,
    include: { author: { select: { id: true, name: true } } },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Notes</span>
        <AddNoteToolbar objectType={objectType} objectId={objectId} as="panel-action" label="+ Add note" />
      </div>
      <div className="activity-list">
        {notes.length === 0 ? (
          <div className="activity-row" style={{ padding: '18px 20px', color: 'var(--muted)', justifyContent: 'center' }}>
            <span className="activity-title muted">No notes yet.</span>
          </div>
        ) : (
          notes.map(n => (
            <div key={n.id} className="activity-row">
              <span className="activity-dot" />
              <div className="activity-body">
                <span className="activity-title">Note</span>
                {n.body && <span className="activity-detail">{n.body}</span>}
              </div>
              <span className="activity-meta">
                <span className="at">{fmtAdminStamp(n.createdAt)}</span>
                <span>·</span>
                <span>{n.author.name}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
