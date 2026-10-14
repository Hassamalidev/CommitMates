'use server';

import {
  jobIdSchema,
  overrideSetting,
  retryJob,
  scheduleToggleSchema,
  settingOverrideSchema,
  toggleSchedule,
} from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireRole } from '@/server/guards';

/** Form actions receive the previous result first (React `useActionState`). */
type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export const toggleScheduleAction: FormAction = async (_previous, formData) =>
  withAction('admin.toggleSchedule', async () => {
    const admin = await requireRole('admin');
    const input = scheduleToggleSchema.parse({
      name: field(formData, 'name'),
      enabled: field(formData, 'enabled') === 'true',
    });
    await toggleSchedule(admin.id, input.name, input.enabled);
    revalidatePath('/admin/jobs');
    return null;
  })();

export const retryJobAction: FormAction = async (_previous, formData) =>
  withAction('admin.retryJob', async () => {
    const admin = await requireRole('admin');
    const input = jobIdSchema.parse({ jobId: field(formData, 'jobId') });
    await retryJob(admin.id, input.jobId);
    revalidatePath('/admin/jobs');
    revalidatePath('/admin/health');
    return null;
  })();

export const overrideSettingAction: FormAction = async (_previous, formData) =>
  withAction('admin.overrideSetting', async () => {
    const admin = await requireRole('admin');
    const input = settingOverrideSchema.parse({ key: field(formData, 'key'), value: field(formData, 'value') });
    await overrideSetting(admin.id, input.key, input.value);
    revalidatePath('/admin/settings');
    return null;
  })();
