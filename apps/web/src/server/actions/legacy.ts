'use server';

import { askLegacyAuthor } from '@commitmates/core';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** "Ask the author" on a library entry (CLAUDE.md §8 F17): a message request with the entry as context. */
export const askLegacyAuthorAction = async (_previous: ActionResult<null> | null, formData: FormData): Promise<ActionResult<null>> =>
  withAction('legacy.ask', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await askLegacyAuthor(member, { entryId: field(formData, 'entryId'), message: field(formData, 'message') });
    return null;
  })();
