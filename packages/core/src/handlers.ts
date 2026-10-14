import { registerHandler, type JobHandler } from '@commitmates/jobs';

import { compatCheckJob } from './compat/jobs';
import { fairnessReportJob } from './fairness/jobs';
import { gapAnalysisJob } from './gap/jobs';
import { geocodePendingJob } from './geocoding/jobs';
import { graveyardSearchJob } from './graveyard/jobs';
import { ossSearchJob } from './oss/jobs';
import { analyzeProfileJob } from './persona/jobs';
import { recruiterReportJob } from './recruiter/jobs';
import { taxonomyExpandJob } from './taxonomy/jobs';
import { purgeNonUserRawJob } from './privacy/jobs';
import { cleanupRateBucketsJob, rotateSaltsJob } from './security/jobs';
import { recomputeSettingsJob } from './settings/jobs';
import { enrichPackagesJob, syncExploreJob, syncGitleaksJob, syncLinguistJob } from './sources/jobs';

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
  define(syncLinguistJob),
  define(syncExploreJob),
  define(syncGitleaksJob),
  define(enrichPackagesJob),
  define(purgeNonUserRawJob),
  define(geocodePendingJob),
  define(analyzeProfileJob),
  define(compatCheckJob),
  define(recruiterReportJob),
  define(fairnessReportJob),
  define(taxonomyExpandJob),
  define(graveyardSearchJob),
  define(gapAnalysisJob),
  define(ossSearchJob),
];

/** Registers every handler. Safe to call on each request: re-registering is a no-op. */
export function registerAllHandlers(): void {
  for (const handler of jobHandlers) handler.register();
}
