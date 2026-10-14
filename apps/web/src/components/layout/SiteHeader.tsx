import { CompanionView, ThemeToggle } from '@commitmates/ui';
import Link from 'next/link';

import { AuthStatus } from '@/components/auth/AuthStatus';
import { navCopy } from '@/copy/nav';
import { themeCopy } from '@/copy/theme';
import { brandCompanion } from '@/lib/brand';
import { siteName } from '@/lib/site';

const linkStyles = 'type-small inline-flex min-h-11 items-center rounded-control px-2 text-fg-muted hover:text-fg';

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <Link href="/" aria-label={navCopy.homeLabel(siteName)} className="inline-flex min-h-11 items-center gap-2">
          <CompanionView companion={brandCompanion} state="idle" size={64} className="size-8" />
          <span className="type-h3 font-display">{siteName}</span>
        </Link>
        <nav aria-label={navCopy.mainLabel} className="flex flex-wrap items-center gap-x-1">
          <Link href="/#tools" className={linkStyles}>
            {navCopy.links.tools}
          </Link>
          <Link href="/#how" className={linkStyles}>
            {navCopy.links.how}
          </Link>
          <Link href="/#faq" className={linkStyles}>
            {navCopy.links.faq}
          </Link>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-x-2">
          <AuthStatus />
          <ThemeToggle labels={themeCopy.labels} actionLabel={themeCopy.action} />
        </div>
      </div>
    </header>
  );
}
