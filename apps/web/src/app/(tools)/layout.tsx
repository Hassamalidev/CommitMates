import type { ReactNode } from 'react';

import { SiteFrame } from '@/components/layout/SiteFrame';

// Tool pages show the visitor's sign-in state and run live analyses.
export const dynamic = 'force-dynamic';

export default function ToolsLayout({ children }: { children: ReactNode }) {
  return <SiteFrame>{children}</SiteFrame>;
}
