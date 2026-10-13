import { registerHandler, type JobHandler } from '@commitmates/jobs';

import { cleanupRateBucketsJob, rotateSaltsJob } from './security/jobs';
import { recomputeSettingsJob } from './settings/jobs';

type Registration = { type: string; register: () => void };

// Keeps each handler's payload type intact until the moment it is registered.
const define = <P>(handler: JobHandler<P>): Registration => ({
  type: handler.type,
  register: () => {
    registerHandler(handler);
  },
});

/** Every job handler in the app. A domain adds its handlers here when it lands. */
export const jobHandlers: readonly Registration[] = [
  define(recomputeSettingsJob),
  define(cleanupRateBucketsJob),
  define(rotateSaltsJob),
];

/** Registers every handler. Safe to call on each request: re-registering is a no-op. */
export function registerAllHandlers(): void {
  for (const handler of jobHandlers) handler.register();
}
