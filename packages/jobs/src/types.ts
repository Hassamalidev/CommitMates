import type { Logger, SettingKey, SettingValue, schema } from '@commitmates/db';
import type { z } from 'zod';

export type Job = typeof schema.jobs.$inferSelect;

export type JobProgress = { step: string; pct?: number; message?: string };

export type JobContext = {
  /** Epoch milliseconds; a handler must return before this. */
  deadline: number;
  now: () => Date;
  /** Stored on the job row and streamed to the browser. */
  progress(progress: JobProgress): Promise<void>;
  log: Logger;
  settings: <K extends SettingKey>(key: K) => Promise<SettingValue<K>>;
  job: { id: string; attempts: number; parentId: string | null };
};

export type JobOutcome =
  | { kind: 'done'; resultRef?: unknown }
  /** Finish this job and enqueue the remainder as a child. */
  | { kind: 'continue'; payload: unknown; delayMs?: number }
  /** Come back later without consuming an attempt. */
  | { kind: 'wait'; until: Date; reason: 'rate_limit' | 'dependency' };

export interface JobHandler<P> {
  type: string;
  /** The payload is validated before `run`; a failure marks the job dead. */
  schema: z.ZodType<P>;
  /** Defaults to `jobs.maxAttempts.default`. */
  maxAttempts?: number;
  /** A `PRIORITY` constant. */
  priority: number;
  /** Must be idempotent: running twice with the same payload stores the same result. */
  run(payload: P, ctx: JobContext): Promise<JobOutcome>;
}
