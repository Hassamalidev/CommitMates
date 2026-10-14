import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SiteFrame } from '@/components/layout/SiteFrame';
import { getCurrentMember } from '@/server/auth';

// Every page here depends on who is signed in.
export const dynamic = 'force-dynamic';

/**
 * The members area (CLAUDE.md §5.11). The proxy already sends signed-out visitors to sign-in;
 * this re-checks on the server, which is the check that counts.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/home');
  return <SiteFrame>{children}</SiteFrame>;
}
