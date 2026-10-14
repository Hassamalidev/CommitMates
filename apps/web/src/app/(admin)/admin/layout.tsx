import { hasRole } from '@commitmates/core';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SiteFrame } from '@/components/layout/SiteFrame';
import { adminCopy } from '@/copy/admin';
import { getCurrentMember } from '@/server/auth';
import { canReview } from '@/server/guards';

export const dynamic = 'force-dynamic';

const links = [
  { href: '/admin/health', label: adminCopy.nav.health, adminOnly: true },
  { href: '/admin/jobs', label: adminCopy.nav.jobs, adminOnly: true },
  { href: '/admin/settings', label: adminCopy.nav.settings, adminOnly: true },
  { href: '/admin/metrics', label: adminCopy.nav.metrics, adminOnly: true },
  { href: '/admin/universities', label: adminCopy.nav.universities, adminOnly: false },
] as const;

/**
 * Every admin page renders inside this layout (CLAUDE.md §5.11). Admins and university moderators
 * may enter; moderators see only the pages for their universities, and admin-only pages check the
 * admin role again. Anyone else gets a 404: the area's existence is not advertised.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/admin/health');
  // Admins and university moderators; admin-only pages check again (`requireAdminPage`).
  if (member.status !== 'active' || !canReview(member)) notFound();
  const admin = hasRole(member, 'admin');

  return (
    <SiteFrame>
      <div className="mx-auto max-w-content px-4 py-8">
        <nav aria-label={adminCopy.navLabel} className="mb-6 flex flex-wrap gap-2 border-b border-line pb-2">
          {links
            .filter((link) => admin || !link.adminOnly)
            .map((link) => (
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
