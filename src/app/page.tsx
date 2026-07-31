import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from '@/lib/auth';
import { BRAND_FULL } from '@/lib/brand';
import { MarketingLanding } from './marketing/MarketingLanding';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${BRAND_FULL} — Premium Mobile Proxies. Real 5G IPs from US Carriers.`,
  description:
    'Premium mobile proxies on real US-carrier devices. Unlimited bandwidth, flexible rotation, transparent pricing.',
};

// Root "/" — the public marketing landing for logged-out visitors (owner ask:
// the site opens at odatai.com, not /marketing). Signed-in users go straight to
// their panel; /marketing redirects here.
export default async function RootPage() {
  const session = await getServerSession(authOptions);
  if (session) {
    if (isAdminRole(session.user.role)) redirect('/admin');
    redirect('/dashboard');
  }
  return <MarketingLanding />;
}
