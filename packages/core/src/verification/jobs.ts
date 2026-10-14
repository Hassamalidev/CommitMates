import { generateOtp, getSetting, getVerificationForSending, hashOtp, storeVerificationCode } from '@commitmates/db';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { deliverEmail } from '../notifications/email';

const MS_PER_MINUTE = 60 * 1000; // allowed-literal: unit conversion

const payloadSchema = z.object({ verificationId: z.uuid() });

/**
 * Generates a verification code, stores only its hash with an expiry, and emails it within the
 * daily cap (CLAUDE.md §8 F10 step 3, §5.10). The code lives only in memory here: it is not in
 * the payload, the result or the logs. A rerun issues a fresh code and the old one stops working.
 */
export const sendOtpJob: JobHandler<z.infer<typeof payloadSchema>> = {
  type: 'send_otp',
  schema: payloadSchema,
  priority: PRIORITY.INTERACTIVE,
  async run(payload, ctx) {
    const target = await getVerificationForSending(payload.verificationId);
    // Already verified, or restarted with another address: nothing to send.
    if (target === null) return { kind: 'done', resultRef: { sent: false } };
    const minutes = await getSetting('verify.otpTtlMinutes');
    const now = ctx.now();
    const code = generateOtp();
    await storeVerificationCode(payload.verificationId, hashOtp(code), new Date(now.getTime() + minutes * MS_PER_MINUTE));
    await deliverEmail('verificationCode', { code, minutes, universityName: target.universityName }, target.email, now);
    return { kind: 'done', resultRef: { sent: true } };
  },
};
