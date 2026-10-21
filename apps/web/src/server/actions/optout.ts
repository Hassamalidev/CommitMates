'use server';

import { optOutOfCountryIndex } from '@commitmates/core';
import { headers } from 'next/headers';

import { withAction, type ActionResult } from '@/server/action';
import { guardToolRate } from '@/server/rate';

/** The public opt-out form (CLAUDE.md §8 F18 "Privacy"), rate-limited by the visitor's hashed address. */
export const optOutAction = async (_previous: ActionResult<null> | null, formData: FormData): Promise<ActionResult<null>> =>
  withAction('crawler.optout', async () => {
    await guardToolRate('optout', await headers());
    const login = formData.get('login');
    await optOutOfCountryIndex({ login: typeof login === 'string' ? login : '' });
    return null;
  })();
