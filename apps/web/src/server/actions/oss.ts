'use server';

import { askOssContributor, ossCampus, type OssCampus } from '@commitmates/core';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser, requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** Members of the viewer's university who contributed to these projects (CLAUDE.md §8 F8 step 5). */
export async function ossCampusAction(repos: string[]): Promise<ActionResult<OssCampus>> {
  return withAction('oss.campus', async () => ossCampus(await requireUser(), { repos }))();
}

/** "Ask" on a contributor: a message request with the project as its context. */
export const askOssContributorAction = async (_previous: ActionResult<null> | null, formData: FormData): Promise<ActionResult<null>> =>
  withAction('oss.ask', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await askOssContributor(member, { toUserId: field(formData, 'toUserId'), repo: field(formData, 'repo'), message: field(formData, 'message') });
    return null;
  })();
