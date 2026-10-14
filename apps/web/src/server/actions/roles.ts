'use server';

import { changeAdmin } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser } from '@/server/guards';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** Grants or removes the admin role (admins only; checked by the core service, CLAUDE.md §5.11). */
export const adminRoleAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('roles.admin', async () => {
    const member = await requireUser();
    await changeAdmin(member, { login: field(formData, 'login'), grant: field(formData, 'grant') === 'true' });
    revalidatePath('/admin/roles');
    return null;
  })();
