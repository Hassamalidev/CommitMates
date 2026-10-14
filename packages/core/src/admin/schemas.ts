import { z } from 'zod';

export const jobIdSchema = z.object({ jobId: z.uuid() });
export const scheduleToggleSchema = z.object({ name: z.string().min(1), enabled: z.boolean() });
export const settingOverrideSchema = z.object({
  key: z.string().min(1),
  /** JSON text as typed by the admin; an empty string clears the override. */
  value: z.string(),
});

export type AlertKey = 'dead_jobs' | 'interactive_queue' | 'database_size' | 'email_quota' | 'stale_source' | 'source_error';

export type Alert = { key: AlertKey; values: Record<string, string | number> };
