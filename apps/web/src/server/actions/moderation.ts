'use server';

import { moderate, viewReportContext, type ReportContextLine } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export type ContextLine = Omit<ReportContextLine, 'createdAt'> & { createdAt: string };

/**
 * The messages around a reported message (CLAUDE.md §8 F12 "Moderation queue"). The service checks
 * the moderator's scope and records the reading in the audit log.
 */
export async function loadReportContextAction(reportId: string): Promise<ActionResult<ContextLine[]>> {
  return withAction('moderation.context', async (): Promise<ContextLine[]> => {
    const member = await requireUser();
    const messages = await viewReportContext(member, { reportId });
    return messages.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() }));
  })();
}

/** Records a moderation decision about a member; scope, limits and the audit entry are the service's. */
export const moderateAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('moderation.decide', async (): Promise<null> => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    await moderate(member, {
      targetUserId: field(formData, 'targetUserId'),
      action: field(formData, 'action'),
      days: field(formData, 'days'),
      note: field(formData, 'note'),
    });
    revalidatePath('/admin/moderation');
    return null;
  })();
