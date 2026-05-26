import { prisma } from '@/lib/prisma';
import { fmtAdminStamp } from '@/lib/date';
import type { NoteObjectType } from '@prisma/client';
import { AddNoteToolbar } from './toolbars/AddNoteToolbar';

export async function EntityNotesPanel({
  objectType, objectId,
}: { objectType: NoteObjectType; objectId: string }) {
  const notes = await prisma.entityNote.findMany({
    where: { objectType, objectId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { author: { select: { id: true, name: true, initials: true, avatarColor: true } } },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Notes</span>
        <AddNoteToolbar objectType={objectType} objectId={objectId} />
      </div>
      <div style={{ padding: notes.length === 0 ? 0 : '0' }}>
        {notes.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <div className="empty-desc">No notes yet. Add the first one with context for the next operator.</div>
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {notes.map(n => (
              <li key={n.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span className="avatar" style={{ width: 24, height: 24, fontSize: 10, background: n.author.avatarColor || 'var(--surface-3)', color: 'white' }}>
                    {n.author.initials ?? n.author.name.charAt(0).toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{n.author.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtAdminStamp(n.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: 4, whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>{n.body}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
