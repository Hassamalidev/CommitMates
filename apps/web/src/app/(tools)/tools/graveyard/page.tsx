import type { Metadata } from 'next';

import { GraveyardTool } from '@/components/graveyard/GraveyardTool';
import { ToolPage } from '@/components/tools/ToolPage';
import { graveyardCopy } from '@/copy/graveyard';
import { getCurrentMember } from '@/server/auth';

type Props = { searchParams: Promise<{ q?: string | string[]; scope?: string | string[] }> };

const firstValue = (value: string | string[] | undefined): string | undefined => {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  return raw === '' ? undefined : raw;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const query = firstValue((await searchParams).q);
  return {
    title: graveyardCopy.meta.title,
    description: graveyardCopy.meta.description,
    // Search result pages are not worth indexing; the tool page itself is.
    ...(query ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function GraveyardPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = firstValue(params.q);
  const scope = firstValue(params.scope) === 'uni' ? 'uni' : 'global';
  const member = await getCurrentMember();
  const viewer = member === null ? 'visitor' : member.verified ? 'verified' : 'member';
  const { page } = graveyardCopy;

  return (
    <ToolPage slug="graveyard" eyebrow={page.eyebrow} title={page.title} line={page.line} signedIn={member !== null}>
      <GraveyardTool initialQuery={query} initialScope={scope} viewer={viewer} />
    </ToolPage>
  );
}
