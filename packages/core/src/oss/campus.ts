import { ValidationError, campusContributors, getSetting, replaceMemberContribs, verifiedMemberLogins, type CampusContributor } from '@commitmates/db';
import { SERVER_IDENTITY, githubFor, parseGitHubUrl, searchIssues } from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { weekStart } from '../adoptions/listings';
import { createRequest } from '../chat/service';
import type { Member } from '../profiles/schemas';
import { getMember } from '../profiles/service';

/** GitHub's largest search page. */
const SEARCH_PAGE_SIZE = 100;
/** Most projects one request may ask about; a result page lists far fewer. Bounds the input only. */
const MAX_ASKED_REPOS = 100;

const payloadSchema = z.union([z.object({ userId: z.uuid() }), z.object({})]);

/** `owner/repo` in the spelling GitHub uses, or null for anything else. */
function repoName(raw: string): string | null {
  const ref = parseGitHubUrl(raw);
  return ref && ref.number === undefined ? `${ref.owner}/${ref.repo}` : null;
}

/**
 * One member's merged pull requests per project (CLAUDE.md §8 F8 step 5): a paced search for
 * `is:pr is:merged author:<login>`, `oss.memberContribPages` pages of the most recent, with the
 * member's own token when valid. Their own repositories are left out; the rows are replaced.
 */
export async function refreshMemberContribs(userId: string, now: Date, deadline: number): Promise<number> {
  const member = await getMember(userId);
  if (!member?.verified || member.login === null) return 0;
  const client = githubFor(member.hasValidToken ? { kind: 'user', userId } : SERVER_IDENTITY);
  const pages = await getSetting('oss.memberContribPages');
  const own = member.login.toLowerCase();
  const byRepo = new Map<string, { mergedPrs: number; lastMergedAt: Date | null }>();
  for (let page = 1; page <= pages; page += 1) {
    const { issues } = await searchIssues(client, `is:pr is:merged author:${member.login}`, { perPage: SEARCH_PAGE_SIZE, page, deadline });
    for (const pull of issues) {
      if (pull.repo.split('/')[0]?.toLowerCase() === own) continue;
      const merged = pull.mergedAt ?? pull.closedAt;
      const current = byRepo.get(pull.repo) ?? { mergedPrs: 0, lastMergedAt: null };
      const at = merged ? new Date(merged) : null;
      byRepo.set(pull.repo, {
        mergedPrs: current.mergedPrs + 1,
        lastMergedAt: at && (!current.lastMergedAt || at > current.lastMergedAt) ? at : current.lastMergedAt,
      });
    }
    if (issues.length < SEARCH_PAGE_SIZE) break;
  }
  await replaceMemberContribs(userId, [...byRepo.entries()].map(([repoFullName, entry]) => ({ repoFullName, ...entry })), now);
  return byRepo.size;
}

/** `member_oss_contribs`: weekly, one refresh per verified member and week. */
export const memberOssContribsJob: JobHandler<z.infer<typeof payloadSchema>> = {
  type: 'member_oss_contribs',
  schema: payloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(payload, ctx) {
    const now = ctx.now();
    if (!('userId' in payload)) {
      const members = await verifiedMemberLogins();
      for (const { userId } of members) {
        await enqueue('member_oss_contribs', { userId }, { idempotencyKey: `oss-contribs:${userId}:${weekStart(now)}`, priority: PRIORITY.MAINTENANCE });
      }
      return { kind: 'done', resultRef: { queued: members.length } };
    }
    return { kind: 'done', resultRef: { repos: await refreshMemberContribs(payload.userId, now, ctx.deadline) } };
  },
};

type Actor = Pick<Member, 'id' | 'verified' | 'universityId'>;

export type OssCampus = { state: 'open'; contributors: Record<string, Omit<CampusContributor, 'repoFullName'>[]> } | { state: 'unverified' };

export const ossCampusSchema = z.object({ repos: z.array(z.string()).max(MAX_ASKED_REPOS) });

/**
 * "Members of your university contributed here" (§8 F8 step 5): for each project, verified members
 * of the viewer's university with merged pull requests there, at most `oss.campusContributorsPerRepo`.
 * Keyed by the project names as asked for.
 */
export async function ossCampus(actor: Actor, raw: unknown): Promise<OssCampus> {
  if (!actor.verified || actor.universityId === null) return { state: 'unverified' };
  const asked = [...new Set(ossCampusSchema.parse(raw).repos)];
  const names = new Map(
    asked.flatMap((repo) => {
      const name = repoName(repo);
      return name ? [[name.toLowerCase(), repo] as const] : [];
    }),
  );
  const rows = await campusContributors(actor.universityId, actor.id, [...names.keys()], await getSetting('oss.campusContributorsPerRepo'));
  const contributors: Record<string, Omit<CampusContributor, 'repoFullName'>[]> = Object.fromEntries(asked.map((repo) => [repo, []]));
  for (const row of rows) {
    const key = names.get(row.repoFullName.toLowerCase());
    if (key !== undefined) contributors[key]?.push({ userId: row.userId, login: row.login, mergedPrs: row.mergedPrs });
  }
  return { state: 'open', contributors };
}

export const askOssContributorSchema = z.object({ toUserId: z.uuid(), repo: z.string().trim().min(1), message: z.string() });

/** "Ask" on a contributor: a message request with `context_kind = 'oss'`, only to someone listed for that project. */
export async function askOssContributor(actor: Actor, raw: unknown, now: Date = new Date()): Promise<string> {
  const input = askOssContributorSchema.parse(raw);
  const name = repoName(input.repo);
  if (name === null) throw new ValidationError('oss.repo_invalid', 'That does not look like a GitHub repository.');
  const result = await ossCampus(actor, { repos: [input.repo] });
  const listed = result.state === 'open' && (result.contributors[input.repo] ?? []).some((person) => person.userId === input.toUserId);
  if (!listed) throw new ValidationError('oss.not_a_contributor', 'That member is not listed for this project any more.');
  return createRequest(actor.id, { toUserId: input.toUserId, message: input.message, contextKind: 'oss', contextId: name, icebreakerKey: null }, now);
}
