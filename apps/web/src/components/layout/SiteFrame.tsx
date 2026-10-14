import type { ReactNode } from 'react';

import { navCopy } from '@/copy/nav';

import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

/** Header, main landmark and footer shared by every public page. */
export function SiteFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        {navCopy.skipToContent}
      </a>
      <SiteHeader />
      <main id="content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
