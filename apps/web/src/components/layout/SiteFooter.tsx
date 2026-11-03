import Link from 'next/link';

import { navCopy } from '@/copy/nav';
import { siteName } from '@/lib/site';

const linkStyles = 'type-small inline-flex min-h-11 items-center text-fg-muted underline-offset-4 hover:text-fg hover:underline';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto flex max-w-content flex-col gap-2 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="type-small text-fg-muted">
          {siteName} · {navCopy.footer.note}
        </p>
        <nav aria-label={navCopy.footerLabel} className="flex flex-wrap gap-x-6">
          <Link href="/attribution" className={linkStyles}>
            {navCopy.footer.attribution}
          </Link>
          <Link href="/privacy" className={linkStyles}>
            {navCopy.footer.privacy}
          </Link>
          <Link href="/terms" className={linkStyles}>
            {navCopy.footer.terms}
          </Link>
          <Link href="/optout" className={linkStyles}>
            {navCopy.footer.optout}
          </Link>
          <Link href="/health" className={linkStyles}>
            {navCopy.footer.status}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
