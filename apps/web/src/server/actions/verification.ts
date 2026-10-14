'use server';

import { confirmEmailCode, guardRate, startEmailVerification, type StartVerificationResult } from '@commitmates/core';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser } from '@/server/guards';
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
    redirect('/home');
  })();
