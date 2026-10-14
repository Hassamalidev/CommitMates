import type { RecruiterResult } from '@commitmates/core';

/** A Recruiter-Ready report of an invented account, in the shape `recruiter_report` stores. */
export const sampleRecruiter: RecruiterResult = {
  login: 'fixture-user-1',
  githubId: 4242,
  isMember: false,
  score: 64,
  usedTopRepos: false,
  secretScanRan: false,
  rules: [
    { key: 'profileReadme', applicable: true, credit: 0, weight: 10, status: 'fail', evidence: { chars: null, min: 200 } },
    { key: 'pinnedCount', applicable: true, credit: 1, weight: 10, status: 'pass', evidence: { count: 2, min: 2, max: 6 } },
    { key: 'pinnedReadme', applicable: true, credit: 0.5, weight: 15, status: 'partial', evidence: { met: 1, total: 2, min: 600, source: 'pinned' } },
    { key: 'pinnedDemo', applicable: true, credit: 0.5, weight: 10, status: 'partial', evidence: { met: 1, total: 2, source: 'pinned' } },
    { key: 'pinnedLicense', applicable: true, credit: 0.5, weight: 5, status: 'partial', evidence: { met: 1, total: 2, source: 'pinned' } },
    { key: 'pinnedDescription', applicable: true, credit: 1, weight: 5, status: 'pass', evidence: { met: 2, total: 2, source: 'pinned' } },
    { key: 'pinnedTopics', applicable: true, credit: 0.5, weight: 5, status: 'partial', evidence: { met: 1, total: 2, source: 'pinned' } },
    { key: 'commitMessages', applicable: true, credit: 0.75, weight: 15, status: 'partial', evidence: { informative: 3, total: 4 } },
    { key: 'unfinishedRatio', applicable: true, credit: 0.5, weight: 10, status: 'partial', evidence: { unfinished: 1, examined: 2 } },
    { key: 'languageMatch', applicable: false, credit: 0, weight: 5, status: 'not-applicable', evidence: { matched: 0, total: 0, missing: [] } },
    { key: 'activityConsistency', applicable: true, credit: 1, weight: 10, status: 'pass', evidence: { activeDayShare: 0.5, target: 0.5 } },
  ],
};
