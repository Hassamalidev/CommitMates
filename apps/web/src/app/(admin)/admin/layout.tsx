import { hasRole } from '@commitmates/core';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SiteFrame } from '@/components/layout/SiteFrame';
import { adminCopy } from '@/copy/admin';
import { getCurrentMember } from '@/server/auth';

export const dynamic = 'force-dynamic';

const links = [
  { href: '/admin/health', label: adminCopy.nav.health },
  { href: '/admin/jobs', label: adminCopy.nav.jobs },
  { href: '/admin/settings', label: adminCopy.nav.settings },
] as const;

/**
 * Every admin page renders inside this layout, so the role check here covers them all
 * (CLAUDE.md §5.11). Members without the role get a 404: the area's existence is not advertised.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/admin/health');
  if (member.status !== 'active' || !hasRole(member, 'admin')) notFound();

  return (
    <SiteFrame>
      <div className="mx-auto max-w-content px-4 py-8">
        <nav aria-label={adminCopy.navLabel} className="mb-6 flex flex-wrap gap-2 border-b border-line pb-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="type-small inline-flex min-h-11 items-center rounded-control px-3 font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </SiteFrame>
  );
}
