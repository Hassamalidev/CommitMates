import { z } from 'zod';

import { lazyEnv, parseEnv, type EnvSource } from './shared';
import { runtimeShape } from './server';

/** The worker runs jobs only: it needs no Supabase API keys, tick secret or admin bootstrap. */
export const workerSchema = z.object(runtimeShape);

export type WorkerEnv = z.infer<typeof workerSchema>;

export const workerEnv = lazyEnv('worker', workerSchema, () => process.env);

/** Validates the whole worker environment; call once at startup to fail fast. */
export function assertWorkerEnv(source: EnvSource = process.env): WorkerEnv {
  return parseEnv('worker', workerSchema, source);
}
