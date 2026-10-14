import { RateLimitedError, ValidationError, checkVerificationCode, getSetting, startPendingVerification } from '@commitmates/db';
import { PRIORITY, enqueue } from '@commitmates/jobs';

import { utcDay } from '../notifications/email';
import { matchEmailToUniversity } from '../universities/service';

import { confirmCodeSchema, startVerificationSchema, type StartVerificationResult } from './schemas';

const SECONDS_PER_DAY = 24 * 60 * 60; // allowed-literal: unit conversion

/**
 * Starts university email verification (CLAUDE.md §8 F10 steps 2–3): the address must belong to
 * a known, non-disposable university domain; sends are capped per member per day; the code
 * itself is generated and emailed by `send_otp`, so it never passes through here.
 */
export async function startEmailVerification(userId: string, raw: unknown, now: Date = new Date()): Promise<StartVerificationResult> {
  const input = startVerificationSchema.parse(raw);
  const check = await matchEmailToUniversity(input.email);
  if (check.status === 'invalid') {
    throw new ValidationError('verify.invalid_email', 'Enter a full email address, like name@university.edu.', { field: 'email' });
  }
  if (check.status === 'disposable') {
    throw new ValidationError('verify.disposable', 'Throwaway email addresses cannot verify a university. Use your university email.', {
      field: 'email',
    });
  }
  if (check.status === 'unknown') return { status: 'unknown', domain: check.domain };

  const chosen = input.universityId === undefined ? undefined : check.universities.find((match) => match.id === input.universityId);
  if (!chosen && check.universities.length > 1) {
    return { status: 'choose', universities: check.universities.map(({ id, name }) => ({ id, name })) };
  }
  const university = chosen ?? check.universities[0];
  if (!university) return { status: 'unknown', domain: check.domain };

  const maxSends = await getSetting('verify.maxSendsPerDay');
  const started = await startPendingVerification(
    { userId, email: input.email.trim().toLowerCase(), domain: check.domain, universityId: university.id },
    now,
    maxSends,
  );
  if (started.status === 'send_limit') {
    throw new RateLimitedError('verify.send_limit', `You can ask for ${maxSends} codes a day. Try again tomorrow.`, SECONDS_PER_DAY);
  }
  // The day is part of the key: the per-day send number starts again at 1 each day.
  const job = await enqueue(
    'send_otp',
    { verificationId: started.id },
    { idempotencyKey: `otp:${started.id}:${utcDay(now)}:${started.sendNumber}`, priority: PRIORITY.INTERACTIVE },
  );
  return { status: 'sent', universityName: university.name, jobId: job.id };
}

/** Checks a code and, when it matches, verifies the member at the university (§8 F10 step 4). */
export async function confirmEmailCode(userId: string, raw: unknown, now: Date = new Date()): Promise<{ universityId: string }> {
  const parsed = confirmCodeSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError('verify.code_format', 'Enter the 6-digit code from the email.', { field: 'code' });
  const maxAttempts = await getSetting('verify.maxAttempts');
  const result = await checkVerificationCode(userId, parsed.data.code, now, maxAttempts);
  const field = { field: 'code' };
  switch (result.status) {
    case 'verified':
      return { universityId: result.universityId };
    case 'no_pending':
      throw new ValidationError('verify.no_pending', 'Start by entering your university email.', { field: 'email' });
    case 'not_sent':
      throw new ValidationError('verify.not_sent', 'Your code is still on its way. Give it a minute.', field);
    case 'expired':
      throw new ValidationError('verify.expired', 'That code has expired. Ask for a new one.', field);
    case 'locked':
      throw new ValidationError('verify.locked', 'Too many wrong tries for this code. Ask for a new one.', field);
    case 'wrong':
      throw new ValidationError(
        'verify.wrong_code',
        result.remaining === 1 ? 'That code is not right. One try left.' : `That code is not right. ${result.remaining} tries left.`,
        field,
      );
  }
}
