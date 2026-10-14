import { insertRecruiterReport } from '@commitmates/db';
import { githubFor } from '@commitmates/github';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';

import { identityFor, readProfile, storeDevCard } from '../persona/jobs';
import { getMember } from '../profiles/service';
import { scanRepositories } from '../secrets/scanner';
import { hourBucket, storeToolResult, type ToolDefinition } from '../tools/service';

import { recruiterInputSchema, recruiterPayloadSchema, recruiterResultSchema, type RecruiterInput, type RecruiterPayload } from './schemas';
import { gatherRecruiterFacts, scoreRecruiterFacts, showcaseRepos } from './service';

/** The steps `recruiter_report` reports, in order. */
export const RECRUITER_STEPS = { profile: 'profile', readmes: 'readmes', secrets: 'secrets', scoring: 'scoring' } as const;

const normalizedSkills = (input: RecruiterInput) =>
  [...new Set((input.resumeSkills ?? []).map((skill) => skill.trim().toLowerCase()))].sort();

export const recruiterTool: ToolDefinition<RecruiterInput> = {
  slug: 'recruiter',
  jobType: 'recruiter_report',
  cacheKind: 'recruiter',
  input: recruiterInputSchema,
  subjectKey: (input) => input.login.toLowerCase(),
  // A run with the owner's secret scan is the owner's alone: keyed by who asked.
  params: (input, context) => ({
    skills: normalizedSkills(input),
    ...(input.scanSecrets && context.userId !== undefined ? { scanFor: context.userId } : {}),
  }),
  idempotencyKey: (input, now) =>
    [
      'recruiter',
      input.login.toLowerCase(),
      normalizedSkills(input).join(','),
      input.scanSecrets ? 'scan' : 'noscan',
      hourBucket(now),
    ].join(':'),
  payload: (input, context) => ({ ...input, ...(context.userId !== undefined ? { requestedBy: context.userId } : {}) }),
  ttlSetting: 'cache.recruiterTtlHours',
};

/** True when the member who asked is the owner of the account being checked. */
async function isOwner(payload: RecruiterPayload): Promise<boolean> {
  if (payload.requestedBy === undefined) return false;
  const member = await getMember(payload.requestedBy);
  return member?.login?.toLowerCase() === payload.login.toLowerCase() && member.hasValidToken;
}

/**
 * Audits how a profile reads to a recruiter (CLAUDE.md §8 F3). When the signed-in member
 * checks their own account, their repositories are also scanned for leaked secrets with
 * their own token; the findings are stored apart from the shareable result.
 */
export const recruiterReportJob: JobHandler<RecruiterPayload> = {
  type: 'recruiter_report',
  schema: recruiterPayloadSchema,
  priority: PRIORITY.INTERACTIVE,
  async run(payload, ctx) {
    await ctx.progress({ step: RECRUITER_STEPS.profile, message: `Reading @${payload.login}` });
    const identity = await identityFor(payload.login, payload.requestedBy);
    const snapshot = await readProfile(payload.login, { identity, ctx });
    const { card } = await storeDevCard(snapshot, ctx.now());
    const client = githubFor(identity, { now: ctx.now });

    await ctx.progress({ step: RECRUITER_STEPS.readmes });
    const { facts, usedTop } = await gatherRecruiterFacts(snapshot, card, payload.resumeSkills ?? [], { client, deadline: ctx.deadline, now: ctx.now() });
    const { score, rules } = await scoreRecruiterFacts(facts);

    const scan = payload.scanSecrets === true && payload.requestedBy !== undefined && (await isOwner(payload));
    if (scan && payload.requestedBy !== undefined) {
      await ctx.progress({ step: RECRUITER_STEPS.secrets });
      // Pinned repositories first, then the rest by stars, until the file cap (§8 F3 "Secret scan" step 1).
      const showcased = showcaseRepos(snapshot, snapshot.profile.repos.length).repos;
      const rest = [...snapshot.profile.repos].sort((a, b) => b.stars - a.stars).filter((repo) => !showcased.includes(repo));
      const report = await scanRepositories(
        identity,
        [...showcased, ...rest].map((repo) => {
          const [owner, name] = repo.fullName.split('/');
          return { owner: owner ?? '', name: name ?? '', defaultBranch: repo.defaultBranch };
        }),
        { now: ctx.now, deadline: ctx.deadline },
      );
      await insertRecruiterReport({
        userId: payload.requestedBy,
        subjectGithubId: snapshot.profile.githubId,
        score,
        rules,
        secretFindings: report.findings,
        secretScanPartial: report.partial || !report.rulesAvailable,
        filesScanned: report.filesScanned,
        computedAt: ctx.now(),
      });
    }

    await ctx.progress({ step: RECRUITER_STEPS.scoring });
    const result = recruiterResultSchema.parse({
      login: snapshot.profile.login,
      githubId: snapshot.profile.githubId,
      isMember: snapshot.isMember,
      score,
      rules,
      usedTopRepos: usedTop,
      secretScanRan: scan,
    });
    const resultRef = await storeToolResult(recruiterTool, payload, result, {
      isMemberSubject: snapshot.isMember,
      now: ctx.now(),
      context: { userId: payload.requestedBy },
    });
    return { kind: 'done', resultRef };
  },
};
