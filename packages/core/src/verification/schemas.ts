import { z } from 'zod';

/** The longest email address SMTP allows (RFC 5321). */
const MAX_EMAIL_LENGTH = 254;
/** Digits in a verification code (CLAUDE.md §5.10). */
export const CODE_DIGITS = 6;

export const startVerificationSchema = z.object({
  email: z.string().trim().min(1).max(MAX_EMAIL_LENGTH),
  /** Chosen when several universities share the email's domain. */
  universityId: z.uuid().optional(),
});
export type StartVerificationInput = z.infer<typeof startVerificationSchema>;

export const confirmCodeSchema = z.object({ code: z.string().trim().regex(new RegExp(`^\\d{${CODE_DIGITS}}$`)) });

export type StartVerificationResult =
  | { status: 'sent'; universityName: string; jobId: string }
  | { status: 'choose'; universities: { id: string; name: string }[] }
  | { status: 'unknown'; domain: string };
