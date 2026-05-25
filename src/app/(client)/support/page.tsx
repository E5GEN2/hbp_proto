import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { fmtDate } from '@/lib/date';
import Link from 'next/link';

export default async function SupportPage() {
  const session = await getServerSession(authOptions);
  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });
  const tickets = await prisma.ticket.findMany({ where: { clientId: session!.user.id }, orderBy: { updatedAt: 'desc' } });

  return (
    <>
      <ClientTopbar title="Support" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="filter-bar">
          <div className="spacer" />
          <button className="btn primary">+ New ticket</button>
        </div>
        <div className="panel" style={{ marginTop: 12 }}>
          {tickets.length === 0 ? (
            <div className="empty">
              <div className="empty-title">No tickets yet</div>
              <div className="empty-desc">Open a ticket and our team will reply within 24 hours.</div>
              <button className="btn primary" style={{ marginTop: 12 }}>+ New ticket</button>
            </div>
          ) : (
            <table className="table">
              <thead><tr><th>Ticket</th><th>Subject</th><th>Category</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id}>
                    <td className="mono"><Link href={`/support/${t.id}`} className="td-link">{t.id}</Link></td>
                    <td>{t.subject}</td>
                    <td>{t.category.toLowerCase()}</td>
                    <td><span className={`chip ${t.status.toLowerCase()}`}>{t.status.toLowerCase()}</span></td>
                    <td>{fmtDate(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
