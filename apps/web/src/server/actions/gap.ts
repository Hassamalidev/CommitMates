'use server';

import { askGapHelper, gapHelpers, type GapHelpers } from '@commitmates/core';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser, requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** Classmates who can help with the gaps' tags (CLAUDE.md §8 F5 step 7), for the signed-in member. */
export async function gapHelpersAction(tags: string[]): Promise<ActionResult<GapHelpers>> {
  return withAction('gap.helpers', async () => gapHelpers(await requireUser(), { tags }))();
}

/** "Ask" on a helper: a message request with the gap as its context. */
export const askGapHelperAction = async (_previous: ActionResult<null> | null, formData: FormData): Promise<ActionResult<null>> =>
  withAction('gap.ask', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await askGapHelper(member, {
      toUserId: field(formData, 'toUserId'),
      repoFullName: field(formData, 'repoFullName'),
      tag: field(formData, 'tag'),
      message: field(formData, 'message'),
    });
    return null;
  })();
