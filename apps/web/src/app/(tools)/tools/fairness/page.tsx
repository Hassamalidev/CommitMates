import { getSetting } from '@commitmates/core';
import type { Metadata } from 'next';

import { FairnessTool } from '@/components/fairness/FairnessTool';
import { ToolPage } from '@/components/tools/ToolPage';
import { fairnessCopy } from '@/copy/fairness';
import { getCurrentMember } from '@/server/auth';

type Props = { searchParams: Promise<{ repo?: string | string[] }> };

const firstValue = (value: string | string[] | undefined): string | undefined => {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  return raw === '' ? undefined : raw;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const repo = firstValue((await searchParams).repo);
  return {
    title: fairnessCopy.meta.title,
    description: fairnessCopy.meta.description,
    // A report names people: never indexed.
    ...(repo ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function FairnessPage({ searchParams }: Props) {
  const repo = firstValue((await searchParams).repo);
  const [member, leastShareThreshold, lateWindowPct] = await Promise.all([
    getCurrentMember(),
    getSetting('fairness.leastShareThreshold'),
    getSetting('fairness.lateWindowPct'),
  ]);
  const { page } = fairnessCopy;

  return (
    <ToolPage slug="fairness" eyebrow={page.eyebrow} title={page.title} line={page.line} signedIn={member !== null}>
      <FairnessTool initialRepo={repo} thresholds={{ leastShareThreshold, lateWindowPct }} />
    </ToolPage>
  );
}
