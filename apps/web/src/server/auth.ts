import 'server-only';

import { ensureMemberRows, getMember, type Member } from '@commitmates/core';
import { cache } from 'react';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The signed-in member for this request, or `null`. The session is verified with
 * Supabase Auth (`getUser`), never trusted from the cookie alone.
 */
export const getCurrentMember = cache(async (): Promise<Member | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;

  const member = await getMember(data.user.id);
  if (member) return member;

  // A valid session without member rows: the callback was interrupted. Repair and continue.
  await ensureMemberRows(data.user.id);
  return getMember(data.user.id);
});
