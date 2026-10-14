import type { Metadata } from 'next';

import { ProsePage } from '@/components/layout/Prose';
import { LEGAL_UPDATED, legalCopy } from '@/copy/legal';

export function generateMetadata(): Metadata {
  return { title: legalCopy.terms.metaTitle, description: legalCopy.terms.intro };
}

export default function TermsPage() {
  const { title, intro, sections } = legalCopy.terms;
  return <ProsePage title={title} intro={intro} updated={LEGAL_UPDATED} sections={sections} />;
}
