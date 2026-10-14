import type { Metadata } from 'next';

import { DevCardTool } from '@/components/dev-card/DevCardTool';
import { ToolPage } from '@/components/tools/ToolPage';
import { devCardCopy } from '@/copy/dev-card';
import { getCurrentMember } from '@/server/auth';

type Props = { searchParams: Promise<{ login?: string | string[] }> };

const firstValue = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const login = firstValue((await searchParams).login);
  return {
    title: devCardCopy.meta.title,
    description: devCardCopy.meta.description,
    // An address that names a person shows a result about them: never indexed (CLAUDE.md §2.6, §10.3).
    ...(login ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function DevCardPage({ searchParams }: Props) {
  const login = firstValue((await searchParams).login)?.trim();
  const initialLogin = login === '' ? undefined : login;
  const member = await getCurrentMember();
  const { page } = devCardCopy;

  return (
    <ToolPage slug="dev-card" eyebrow={page.eyebrow} title={page.title} line={page.line} signedIn={member !== null}>
      <DevCardTool initialLogin={initialLogin} />
    </ToolPage>
  );
}
