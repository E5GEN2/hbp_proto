import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// The marketing landing now lives at the root "/" (owner ask). Keep /marketing
// as a permanent redirect so existing links/bookmarks (and the auth logo pill,
// whose source we leave untouched) still resolve.
export default function MarketingRedirect() {
  redirect('/');
}
