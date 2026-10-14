import { getSetting } from '@commitmates/core';
import type { Metadata } from 'next';

import { GapTool } from '@/components/gap/GapTool';
import { ToolPage } from '@/components/tools/ToolPage';
import { gapCopy } from '@/copy/gap';
import { getCurrentMember } from '@/server/auth';

type Props = { searchParams: Promise<{ repo?: string | string[] }> };

const firstValue = (value: string | string[] | undefined): string | undefined => {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  return raw === '' ? undefined : raw;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const repo = firstValue((await searchParams).repo);
  return {
    title: gapCopy.meta.title,
    description: gapCopy.meta.description,
    ...(repo ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function GapPage({ searchParams }: Props) {
  const repo = firstValue((await searchParams).repo);
  const [member, campusMinMembers] = await Promise.all([getCurrentMember(), getSetting('unlock.gapCampus.minMembers')]);
  const { page } = gapCopy;

  return (
    <ToolPage slug="gap" eyebrow={page.eyebrow} title={page.title} line={page.line} signedIn={member !== null}>
      <GapTool initialRepo={repo} campusMinMembers={campusMinMembers} />
    </ToolPage>
  );
}
