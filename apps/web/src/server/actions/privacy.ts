'use server';

import { ExternalServiceError, prepareAccountDeletion, updatePrivacySettings } from '@commitmates/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction, type ActionResult } from '@/server/action';
import { requireUser } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** Who can see the profile, and ghost mode (CLAUDE.md §5.12). */
export const updatePrivacyAction: FormAction = async (_previous, formData) =>
  withAction('privacy.update', async () => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    await updatePrivacySettings(member, {
      visibility: field(formData, 'visibility'),
      ghostMode: field(formData, 'ghostMode'),
    });
    revalidatePath('/settings/privacy');
    return null;
  })();

/**
 * Deletes the account (§5.12): the typed confirmation is checked and data without a foreign key is
 * removed, then the auth user is deleted, which cascades to every other row, and the session ends.
 */
export const deleteAccountAction: FormAction = async (_previous, formData) =>
  withAction('privacy.delete', async () => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    await prepareAccountDeletion(member, { confirm: field(formData, 'confirm') });
    const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(member.id);
    if (error)
      throw new ExternalServiceError(
        'privacy.delete_failed',
        'We could not finish deleting your account. Please try again.',
        { cause: error },
      );
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect('/?account=deleted');
  })();
