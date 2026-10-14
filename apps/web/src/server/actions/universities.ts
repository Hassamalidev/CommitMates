'use server';

import { NotFoundError, changeModerator, getUniversityBySlug, requestUniversity, reviewRequest } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { adminCopy } from '@/copy/admin';
import { withAction, type ActionResult } from '@/server/action';
import { requireUser } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** A university id from either a chosen id (moderators) or a typed slug (admins). */
async function universityIdFrom(formData: FormData): Promise<string> {
  const id = field(formData, 'universityId');
  if (id) return id;
  const university = await getUniversityBySlug(field(formData, 'universitySlug'));
  if (!university) throw new NotFoundError('universities.not_found', adminCopy.universities.unknownUniversity);
  return university.id;
}

/** "Request my university" from onboarding (CLAUDE.md §8 F10 step 2). */
export const requestUniversityAction: FormAction = async (_previous, formData) =>
  withAction('universities.request', async () => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    await requestUniversity(member.id, {
      domain: field(formData, 'domain'),
      proposedName: field(formData, 'proposedName'),
      countryCode: field(formData, 'countryCode'),
    });
    revalidatePath('/onboarding');
    return null;
  })();

/**
 * Reviews a request (§8 F10 step 6). The decision comes from the button pressed; permissions
 * (admin, or moderator of the university or country) are checked by the core service.
 */
export const reviewRequestAction: FormAction = async (_previous, formData) =>
  withAction('universities.review', async () => {
    const member = await requireUser();
    const requestId = field(formData, 'requestId');
    const decision = field(formData, 'decision');
    if (decision === 'create') {
      await reviewRequest(member, { decision, requestId, name: field(formData, 'name'), countryCode: field(formData, 'countryCode') });
    } else if (decision === 'attach') {
      await reviewRequest(member, { decision, requestId, universityId: await universityIdFrom(formData) });
    } else {
      const note = field(formData, 'note').trim();
      await reviewRequest(member, { decision: 'reject', requestId, ...(note ? { note } : {}) });
    }
    revalidatePath('/admin/universities');
    return null;
  })();

/** Grants or removes a moderator (admins only, §5.11). */
export const moderatorAction: FormAction = async (_previous, formData) =>
  withAction('universities.moderator', async () => {
    const member = await requireUser();
    await changeModerator(member, {
      login: field(formData, 'login'),
      universityId: await universityIdFrom(formData),
      grant: field(formData, 'grant') === 'true',
    });
    revalidatePath('/admin/universities');
    return null;
  })();
