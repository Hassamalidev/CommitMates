'use server';

import {
  chooseUniversityForVouching,
  confirmEmailCode,
  guardRate,
  saveOnboardingDetails,
  startEmailVerification,
  vouchForMember,
  type StartVerificationResult,
} from '@commitmates/core';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser, requireVerified } from '@/server/guards';
import { startJobAfterResponse } from '@/server/jobs';
import { guardWriteRate, requestIpHash } from '@/server/rate';

/** What the email step shows next; the job id stays on the server. */
export type StartResult = Exclude<StartVerificationResult, { status: 'sent' }> | { status: 'sent'; universityName: string };

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/**
 * Starts email verification (CLAUDE.md §8 F10 steps 2–3). Limited per member and per hashed
 * address, on top of the per-day send cap the service enforces.
 */
export const startVerificationAction = async (_previous: ActionResult<StartResult> | null, formData: FormData) =>
  withAction('verification.start', async (): Promise<StartResult> => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    await guardRate(`verify:ip:${await requestIpHash(await headers())}`, 'rate.write');
    const universityId = field(formData, 'universityId');
    const result = await startEmailVerification(member.id, { email: field(formData, 'email'), ...(universityId ? { universityId } : {}) });
    if (result.status !== 'sent') return result;
    startJobAfterResponse(result.jobId);
    return { status: 'sent', universityName: result.universityName };
  })();

/** Checks the code; on success the member is verified and continues to their home. */
export const confirmCodeAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('verification.confirm', async (): Promise<null> => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    await confirmEmailCode(member.id, { code: field(formData, 'code') });
    revalidatePath('/', 'layout');
    // Next: the onboarding details, then home.
    redirect('/onboarding');
  })();

/** Picks the university for the vouching path (CLAUDE.md §8 F10 step 5). */
export const chooseUniversityAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('verification.chooseUniversity', async (): Promise<null> => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    await chooseUniversityForVouching(member, { universityId: field(formData, 'universityId') });
    revalidatePath('/onboarding');
    return null;
  })();

/** A verified member vouches for another from their profile page (§8 F10 step 5). */
export const vouchAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('verification.vouch', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const login = field(formData, 'login');
    await vouchForMember(member, { login });
    revalidatePath(`/u/${encodeURIComponent(login)}`);
    return null;
  })();

/** Saves the onboarding details (CLAUDE.md §8 F10 step 7) and continues to home. */
export const saveDetailsAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('onboarding.details', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await saveOnboardingDetails(member, {
      role: field(formData, 'role'),
      gradYear: field(formData, 'gradYear'),
      department: field(formData, 'department'),
      learningGoals: field(formData, 'learningGoals'),
      visibility: field(formData, 'visibility'),
      shareTodayStatus: field(formData, 'shareTodayStatus'),
      emailDigest: field(formData, 'emailDigest'),
      timezone: field(formData, 'timezone'),
    });
    revalidatePath('/', 'layout');
    redirect('/home');
  })();
