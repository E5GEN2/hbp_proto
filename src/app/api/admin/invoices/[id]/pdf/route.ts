import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildInvoicePdf } from '@/lib/invoice-pdf';

export const dynamic = 'force-dynamic';

// Admin-only invoice PDF (audit B-8). The client portal deliberately has no
// invoice surface at launch — this route is the only consumer.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || !isAdminRole(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const inv = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: { payment: true, order: { include: { plan: true } }, client: true },
  });
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const bytes = await buildInvoicePdf(inv);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${inv.id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
