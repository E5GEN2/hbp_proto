import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';

export default async function SupportPage() {
  const session = await getServerSession(authOptions);
  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });

  return (
    <>
      <ClientTopbar title="Support" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto', maxWidth: 760, margin: '0 auto' }}>
        <div className="panel" style={{ padding: 32, textAlign: 'center' }}>
          <span className="chip accent" style={{ marginBottom: 12 }}>v2 preview</span>
          <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Support tickets — coming in v2</h2>
          <p className="t-body" style={{ maxWidth: 480, margin: '0 auto' }}>
            Ticket-based support ships in v2 (see <code>ROADMAP.md</code> in the handoff repo). For now,
            reach our team directly via Telegram and we&rsquo;ll get back within 24 hours.
          </p>
          <div style={{ marginTop: 18 }}>
            <a href="https://t.me/proxysupport" target="_blank" rel="noopener noreferrer" className="btn primary">
              Open Telegram support
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
