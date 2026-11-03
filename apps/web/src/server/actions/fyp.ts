'use server';

import { checkIdeaAtUniversity, type UniversityMatch } from '@commitmates/core';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

/**
 * The "At your university" list of the FYP Idea Checker (CLAUDE.md §8 F9 step 6): null until the
 * member's university records enough confirmed past projects.
 */
export async function universityMatchesAction(input: { title: string; description: string }): Promise<ActionResult<UniversityMatch[] | null>> {
  return withAction('fyp.university', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    return checkIdeaAtUniversity(member, input);
  })();
}
