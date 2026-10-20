import { registerHandler, type JobHandler } from '@commitmates/jobs';

import { compatCheckJob } from './compat/jobs';
import { fairnessReportJob } from './fairness/jobs';
import { fypCheckJob } from './fyp/jobs';
import { gapAnalysisJob } from './gap/jobs';
import { geocodePendingJob } from './geocoding/jobs';
import { graveyardSearchJob } from './graveyard/jobs';
import { ossSearchJob } from './oss/jobs';
import { analyzeProfileJob } from './persona/jobs';
import { recruiterReportJob } from './recruiter/jobs';
import { taxonomyExpandJob } from './taxonomy/jobs';
import { matchDailyJob } from './matching/daily';
import { tuneMatchWeightsJob } from './matching/tune';
import { computeTrustJob } from './safety/trust';
import { streakCheckJob } from './streaks/judge';
import { liftSuspensionsJob } from './admin/moderation';
import { computeSkillVectorJob, refreshSkillVectorsJob } from './matching/vectors';
import { digestEmailJob } from './notifications/center';
import { sendEmailJob } from './notifications/email';
import { sendOtpJob } from './verification/jobs';
import { purgeNonUserRawJob } from './privacy/jobs';
import { cleanupRateBucketsJob, rotateSaltsJob } from './security/jobs';
import { recomputeSettingsJob } from './settings/jobs';
import {
  enrichPackagesJob,
  syncDisposableEmailsJob,
  syncExploreJob,
  syncGitleaksJob,
  syncHipoJob,
  syncLinguistJob,
  syncStopwordsJob,
} from './sources/jobs';

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
  define(syncStopwordsJob),
  define(syncHipoJob),
  define(syncDisposableEmailsJob),
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
  define(fypCheckJob),
  define(sendEmailJob),
  define(sendOtpJob),
  define(computeSkillVectorJob),
  define(refreshSkillVectorsJob),
  define(matchDailyJob),
  define(tuneMatchWeightsJob),
  define(computeTrustJob),
  define(streakCheckJob),
  define(digestEmailJob),
  define(liftSuspensionsJob),
];

/** Registers every handler. Safe to call on each request: re-registering is a no-op. */
export function registerAllHandlers(): void {
  for (const handler of jobHandlers) handler.register();
}
