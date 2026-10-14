import type { Metadata } from 'next';

import { ProsePage } from '@/components/layout/Prose';
import { LEGAL_UPDATED, legalCopy } from '@/copy/legal';

export function generateMetadata(): Metadata {
  return { title: legalCopy.privacy.metaTitle, description: legalCopy.privacy.intro };
}

export default function PrivacyPage() {
  const { title, intro, sections } = legalCopy.privacy;
  return <ProsePage title={title} intro={intro} updated={LEGAL_UPDATED} sections={sections} />;
}
