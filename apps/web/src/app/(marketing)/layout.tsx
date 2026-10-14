import type { ReactNode } from 'react';

import { SiteFrame } from '@/components/layout/SiteFrame';

// The header shows the visitor's sign-in state.
export const dynamic = 'force-dynamic';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <SiteFrame>{children}</SiteFrame>;
}
