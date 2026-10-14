import { compatShareAllowed } from '@commitmates/core';
import { Card, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';

import { CompatTool } from '@/components/compat/CompatTool';
import { ShareButton } from '@/components/share/ShareButton';
import { ToolPage } from '@/components/tools/ToolPage';
import { compatCopy } from '@/copy/compat';
import { shareCopy } from '@/copy/share';
import { siteName, siteUrl } from '@/lib/site';
import { getCurrentMember } from '@/server/auth';

type Props = { searchParams: Promise<{ a?: string | string[]; b?: string | string[] }> };

const firstValue = (value: string | string[] | undefined): string | undefined => {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  return raw === '' ? undefined : raw;
};

async function pairFrom(searchParams: Props['searchParams']) {
  const params = await searchParams;
  const a = firstValue(params.a);
  const b = firstValue(params.b);
  return a && b ? { a, b } : undefined;
}

const comparisonPath = (pair: { a: string; b: string }) => `/tools/compat?${new URLSearchParams(pair).toString()}`;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const pair = await pairFrom(searchParams);
  const shareable = pair ? await compatShareAllowed(pair.a, pair.b, null) : false;
  return {
    title: compatCopy.meta.title,
    description: compatCopy.meta.description,
    // A comparison is about people: never indexed (CLAUDE.md §8 F2 "Privacy").
    ...(pair ? { robots: { index: false, follow: false } } : {}),
    // The image exists only where anyone may share the comparison: both people are public members.
    ...(pair && shareable
      ? {
          openGraph: {
            images: [{ url: `/api/og/compat?${new URLSearchParams(pair).toString()}`, width: 1200, height: 630 }],
          },
          twitter: { card: 'summary_large_image' },
        }
      : {}),
  };
}

export default async function CompatPage({ searchParams }: Props) {
  const pair = await pairFrom(searchParams);
  const member = await getCurrentMember();
  const shareable = pair ? await compatShareAllowed(pair.a, pair.b, member?.login ?? null) : false;
  const { page, cta } = compatCopy;

  return (
    <ToolPage slug="compat" eyebrow={page.eyebrow} title={page.title} line={page.line} signedIn={member !== null} saveOffer={false}>
      <CompatTool initial={pair} memberLogin={member?.login ?? undefined} />
      {pair && shareable ? (
        <ShareButton url={`${siteUrl}${comparisonPath(pair)}`} title={shareCopy.compareTitle(pair.a, pair.b, siteName)} />
      ) : null}
      {member ? null : (
        <Card title={cta.title} className="flex flex-col items-start gap-3">
          <p className="type-body text-fg-muted">{cta.line}</p>
          <a
            href={`/auth/sign-in?next=${encodeURIComponent(pair ? comparisonPath(pair) : '/tools/compat')}`}
            className={buttonStyles({ variant: 'primary', size: 'md' })}
          >
            {cta.action}
          </a>
        </Card>
      )}
    </ToolPage>
  );
}
