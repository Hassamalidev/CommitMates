import { CompanionView, EmptyState, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFrame } from '@/components/layout/SiteFrame';
import { errorsCopy } from '@/copy/errors';
import { brandCompanion } from '@/lib/brand';

export function generateMetadata(): Metadata {
  return { title: errorsCopy.notFound.metaTitle, robots: { index: false } };
}

export default function NotFound() {
  const copy = errorsCopy.notFound;
  return (
    <SiteFrame>
      <EmptyState
        className="py-20"
        companion={<CompanionView companion={brandCompanion} state="idle" size={160} label={copy.companionLabel} />}
        title={copy.title}
        description={copy.line}
        action={
          <Link href="/" className={buttonStyles({ variant: 'primary' })}>
            {copy.action}
          </Link>
        }
      />
      <h1 className="sr-only">{copy.title}</h1>
    </SiteFrame>
  );
}
