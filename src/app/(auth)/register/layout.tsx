import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';

// The register page is a client component and can't export metadata itself, so a
// tiny server layout gives the route its own title, overriding the (auth) group
// default of "Sign in — …". Transparent wrapper — no markup, no styling change.
export const metadata: Metadata = { title: `Create account — ${BRAND_NAME}` };

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
