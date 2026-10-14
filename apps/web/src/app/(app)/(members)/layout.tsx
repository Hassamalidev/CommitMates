import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getCurrentMember } from '@/server/auth';

/** Pages for verified members only; anyone else is sent to verify first (CLAUDE.md §5.11). */
export default async function MembersLayout({ children }: { children: ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/home');
  if (!member.verified) redirect('/onboarding');
  return children;
}
