'use server';

import { setLeaderboardOptIn } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

/** Joins or leaves the members board (CLAUDE.md §8 F19 step 6). */
export const setLeaderboardOptInAction = async (_previous: ActionResult<null> | null, formData: FormData): Promise<ActionResult<null>> =>
  withAction('leaderboards.optin', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await setLeaderboardOptIn(member, { optIn: formData.get('optIn') === 'true' });
    revalidatePath('/leaderboards');
    return null;
  })();
