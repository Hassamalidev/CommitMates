import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SiteFrame } from '@/components/layout/SiteFrame';
import { safetyCopy } from '@/copy/safety';
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
  return (
    <SiteFrame>
      {/* A neutral notice while reports are reviewed, with a way to answer them (§8 F12 "Reports and auto-hide"). */}
      {member.status === 'hidden_pending_review' ? (
        <section aria-labelledby="hidden-notice" className="border-b border-line bg-surface-2">
          <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <h2 id="hidden-notice" className="type-small font-semibold">
              {safetyCopy.hidden.title}
            </h2>
            <p className="type-small text-fg-muted">{safetyCopy.hidden.line}</p>
            <Link href="/feedback?about=appeal" className="type-small underline">
              {safetyCopy.hidden.appeal}
            </Link>
          </div>
        </section>
      ) : null}
      {children}
    </SiteFrame>
  );
}
