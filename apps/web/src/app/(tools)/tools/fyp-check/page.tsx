import { FYP_DESCRIPTION_MAX, FYP_DESCRIPTION_MIN, FYP_TITLE_MAX } from '@commitmates/core';
import type { Metadata } from 'next';

import { FypTool } from '@/components/fyp/FypTool';
import { ToolPage } from '@/components/tools/ToolPage';
import { fypCopy } from '@/copy/fyp';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: fypCopy.meta.title, description: fypCopy.meta.description };
}

export default async function FypCheckPage() {
  const member = await getCurrentMember();
  const { page } = fypCopy;

  return (
    <ToolPage slug="fyp-check" eyebrow={page.eyebrow} title={page.title} line={page.line} signedIn={member !== null}>
      <FypTool limits={{ titleMax: FYP_TITLE_MAX, descriptionMin: FYP_DESCRIPTION_MIN, descriptionMax: FYP_DESCRIPTION_MAX }} />
    </ToolPage>
  );
}
