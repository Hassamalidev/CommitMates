'use server';

import {
  adjustCredits,
  claimRequest,
  createReviewRequest,
  disputeRating,
  markSubmitted,
  rateReview,
  resolveDispute,
  unclaimRequest,
  withdrawReviewRequest,
} from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser, requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

/** Runs one Review Exchange step for the signed-in verified member, rate-limited (CLAUDE.md §8 F15). */
const memberStep = (name: string, run: (member: Awaited<ReturnType<typeof requireVerified>>, formData: FormData) => Promise<unknown>): FormAction =>
  async (_previous, formData) =>
    withAction(name, async () => {
      const member = await requireVerified();
      await guardWriteRate(member.id);
      await run(member, formData);
      revalidatePath('/reviews');
      return null;
    })();

/** Offers one of the member's pull requests for review, holding a credit (§8 F15 "Request"). */
export const createReviewRequestAction = memberStep('reviews.create', (member, formData) => createReviewRequest(member, { prUrl: field(formData, 'prUrl') }));

/** Claims an open request (§8 F15 "Claim and verify" step 2). */
export const claimRequestAction = memberStep('reviews.claim', (member, formData) => claimRequest(member, { requestId: field(formData, 'requestId') }));

/** Gives a claim back. */
export const unclaimRequestAction = memberStep('reviews.unclaim', (member, formData) => unclaimRequest(member, { requestId: field(formData, 'requestId') }));

/** "I've submitted my review": GitHub is checked in the background (§8 F15 step 3). */
export const markSubmittedAction = memberStep('reviews.submitted', (member, formData) => markSubmitted(member, { requestId: field(formData, 'requestId') }));

/** The author rates a verified review; the credit settles with it. */
export const rateReviewAction = memberStep('reviews.rate', (member, formData) =>
  rateReview(member, { requestId: field(formData, 'requestId'), rating: field(formData, 'rating') }),
);

/** The author withdraws a request nobody claimed. */
export const withdrawReviewRequestAction = memberStep('reviews.withdraw', (member, formData) =>
  withdrawReviewRequest(member, { requestId: field(formData, 'requestId') }),
);

/** The reviewer disputes an unhelpful rating. */
export const disputeRatingAction = memberStep('reviews.dispute', (member, formData) =>
  disputeRating(member, { requestId: field(formData, 'requestId'), note: field(formData, 'note') }),
);

/** A moderator's decision on a dispute; the service checks the role and scope. */
export const resolveDisputeAction: FormAction = async (_previous, formData) =>
  withAction('reviews.resolve', async () => {
    const member = await requireUser();
    await resolveDispute(member, { requestId: field(formData, 'requestId'), outcome: field(formData, 'outcome'), note: field(formData, 'note') });
    revalidatePath('/admin/moderation');
    return null;
  })();

/** An admin's audited credit correction. */
export const adjustCreditsAction: FormAction = async (_previous, formData) =>
  withAction('reviews.adjust', async () => {
    const member = await requireUser();
    await adjustCredits(member, { login: field(formData, 'login'), delta: field(formData, 'delta'), note: field(formData, 'note') });
    revalidatePath('/admin/moderation');
    return null;
  })();
