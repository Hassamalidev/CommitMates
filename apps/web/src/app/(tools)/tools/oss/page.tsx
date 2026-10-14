import { listLanguageNames } from '@commitmates/core';
import type { Metadata } from 'next';

import { OssTool } from '@/components/oss/OssTool';
import { ToolPage } from '@/components/tools/ToolPage';
import { ossCopy } from '@/copy/oss';
import { getCurrentMember } from '@/server/auth';

type Props = { searchParams: Promise<{ login?: string | string[] }> };

const firstValue = (value: string | string[] | undefined): string | undefined => {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  return raw === '' ? undefined : raw;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const login = firstValue((await searchParams).login);
  return {
    title: ossCopy.meta.title,
    description: ossCopy.meta.description,
    ...(login ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function OssPage({ searchParams }: Props) {
  const login = firstValue((await searchParams).login);
  const [member, languageOptions] = await Promise.all([getCurrentMember(), listLanguageNames()]);
  const { page } = ossCopy;

  return (
    <ToolPage slug="oss" eyebrow={page.eyebrow} title={page.title} line={page.line} signedIn={member !== null}>
      <OssTool initialLogin={login ?? member?.login ?? undefined} languageOptions={languageOptions} />
    </ToolPage>
  );
}
