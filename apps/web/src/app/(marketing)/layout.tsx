import type { ReactNode } from 'react';

import { SiteFrame } from '@/components/layout/SiteFrame';

// Public pages are prerendered; the header reads the sign-in state in the browser.
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <SiteFrame>{children}</SiteFrame>;
}
