import type { Metadata } from 'next';

import { RecruiterTool } from '@/components/recruiter/RecruiterTool';
import { ToolPage } from '@/components/tools/ToolPage';
import { recruiterCopy } from '@/copy/recruiter';
import { getCurrentMember } from '@/server/auth';

type Props = { searchParams: Promise<{ login?: string | string[] }> };

const firstValue = (value: string | string[] | undefined): string | undefined => {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  return raw === '' ? undefined : raw;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const login = firstValue((await searchParams).login);
  return {
    title: recruiterCopy.meta.title,
    description: recruiterCopy.meta.description,
    // A report about a person is never indexed (CLAUDE.md §2.6, §10.3).
    ...(login ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function RecruiterPage({ searchParams }: Props) {
  const login = firstValue((await searchParams).login);
  const member = await getCurrentMember();
  const { page } = recruiterCopy;

  return (
    <ToolPage slug="recruiter" eyebrow={page.eyebrow} title={page.title} line={page.line} signedIn={member !== null}>
      <RecruiterTool initialLogin={login} memberLogin={member?.login ?? undefined} />
    </ToolPage>
  );
}
