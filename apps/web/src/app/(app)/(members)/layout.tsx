import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getCurrentMember } from '@/server/auth';

/** Pages for verified, onboarded members only; anyone else finishes onboarding first (CLAUDE.md §5.11, §8 F10). */
export default async function MembersLayout({ children }: { children: ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/home');
  if (!member.verified || !member.onboarded) redirect('/onboarding');
  return children;
}
