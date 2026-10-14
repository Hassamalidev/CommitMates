import { ValidationError, authEmailOf, deleteMemberData, exportMemberRows, getLogger, schema, updatePrivacy } from '@commitmates/db';
import { z } from 'zod';

import { deliverEmail } from '../notifications/email';
import type { Member } from '../profiles/schemas';

/** What a member types to confirm deletion when they have no GitHub login on record. */
export const DELETE_PHRASE = 'delete my account';

export const privacySettingsSchema = z.object({
  visibility: z.enum(schema.profileVisibility.enumValues),
  ghostMode: z.union([z.boolean(), z.literal('on'), z.literal('')]).transform((value) => value === true || value === 'on'),
});

/** The member's data as one JSON document (CLAUDE.md §5.12 "Export"). */
export async function exportMemberData(member: Pick<Member, 'id' | 'login'>, now: Date = new Date()) {
  return { exportedAt: now.toISOString(), member: { id: member.id, login: member.login }, tables: await exportMemberRows(member.id) };
}

/** Saves who can see the profile and whether the member is in ghost mode (§2.6, §5.12). */
export async function updatePrivacySettings(member: Pick<Member, 'id'>, raw: unknown): Promise<void> {
  await updatePrivacy(member.id, privacySettingsSchema.parse(raw));
}

/** The text the member must type: their GitHub login, or a fixed phrase without one. */
export const deletionConfirmation = (member: Pick<Member, 'login'>): string => member.login ?? DELETE_PHRASE;

/**
 * The first part of account deletion (§5.12): checks the typed confirmation, emails a confirmation
 * (best effort; it cannot be sent afterwards), and deletes what no foreign key cascades from. The
 * caller then deletes the auth user, which removes every remaining row through cascades.
 */
export async function prepareAccountDeletion(member: Pick<Member, 'id' | 'login'>, raw: unknown, now: Date = new Date()): Promise<void> {
  const { confirm } = z.object({ confirm: z.string() }).parse(raw);
  if (confirm.trim().replace(/^@/, '').toLowerCase() !== deletionConfirmation(member).toLowerCase()) {
    throw new ValidationError('privacy.confirm_mismatch', `Type ${deletionConfirmation(member)} to confirm.`, { field: 'confirm' });
  }
  try {
    const email = await authEmailOf(member.id);
    if (email) await deliverEmail('accountNotice', { notice: 'deletion_confirmed' }, email, now);
  } catch (error) {
    getLogger().warn({ err: error }, 'deletion email not sent');
  }
  await deleteMemberData(member.id, now);
}
