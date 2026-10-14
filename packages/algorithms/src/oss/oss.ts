/**
 * Open-Source Starter: how responsive a project is to newcomers, and how well an issue fits.
 * Formula: response hours of an issue = hours from creation to the first comment by an owner,
 *            member or collaborator (an issue without one counts as the hours it has waited);
 *          responsiveness = median of those over the sampled issues opened by non-maintainers;
 *          rank = 0.5·skillMatch + 0.3·freshness + 0.2·responsiveness_n, with
 *            freshness = exp(−ageDays / 30) and responsiveness_n = 1 − medianHours / maxResponseHours
 * Settings: oss.maxResponseHours, oss.responsivenessSample, oss.maxComments
 * Spec: CLAUDE.md §8 F8 steps 2–4
 */

import { clamp, percentile } from '../stats/basic';

/** Weights of the rank (§8 F8 step 4). */
export const SKILL_WEIGHT = 0.5;
export const FRESHNESS_WEIGHT = 0.3;
export const RESPONSIVENESS_WEIGHT = 0.2;
/** Freshness halves roughly monthly: exp(−age / 30 days) (§8 F8 step 4). */
export const FRESHNESS_DAYS = 30;
/** GitHub's author associations that count as the project answering. */
export const MAINTAINER_ROLES: readonly string[] = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const MEDIAN = 0.5;
const MS_PER_HOUR = 3_600_000; // allowed-literal: unit conversion

export type SampledIssue = { createdAt: string; authorAssociation: string; firstMaintainerReplyAt: string | null };

/** Median hours until a maintainer first replied to issues opened by others; `null` without such issues. */
export function medianResponseHours(issues: readonly SampledIssue[], now: Date): number | null {
  const hours = issues
    .filter((issue) => !MAINTAINER_ROLES.includes(issue.authorAssociation))
    .map((issue) => {
      const opened = new Date(issue.createdAt).getTime();
      const answered = issue.firstMaintainerReplyAt === null ? now.getTime() : new Date(issue.firstMaintainerReplyAt).getTime();
      return Math.max(0, (answered - opened) / MS_PER_HOUR);
    });
  return hours.length === 0 ? null : percentile(hours, MEDIAN);
}

/** Share of the person's languages and topics the project covers, in [0, 1]; 0 when the person gave none. */
export function skillMatch(
  project: { language: string | null; topics: readonly string[] },
  person: { languages: readonly string[]; topics: readonly string[] },
): number {
  const wanted = new Set([...person.languages, ...person.topics].map((value) => value.toLowerCase()));
  if (wanted.size === 0) return 0;
  const offered = new Set([...(project.language ? [project.language] : []), ...project.topics].map((value) => value.toLowerCase()));
  let covered = 0;
  for (const value of wanted) if (offered.has(value)) covered += 1;
  return covered / wanted.size;
}

/** The issue's rank; responsiveness unknown counts as the slowest allowed. */
export function issueRank(input: { skillMatch: number; ageDays: number; responseHours: number | null; maxResponseHours: number }): number {
  const freshness = Math.exp(-Math.max(0, input.ageDays) / FRESHNESS_DAYS);
  const responsiveness = input.responseHours === null || input.maxResponseHours <= 0 ? 0 : clamp(1 - input.responseHours / input.maxResponseHours, 0, 1);
  return SKILL_WEIGHT * clamp(input.skillMatch, 0, 1) + FRESHNESS_WEIGHT * freshness + RESPONSIVENESS_WEIGHT * responsiveness;
}

export type IssueGate = 'comments' | 'responsiveness';

/** Gates in the order they are relaxed when nothing passes (§8 F8 "Edge cases"). */
export const RELAX_ORDER: readonly IssueGate[] = ['comments', 'responsiveness'];

/**
 * Applies the per-issue gates; when nothing passes, relaxes them one at a time in order and
 * says which were relaxed.
 */
export function applyGates<T extends { comments: number; responseHours: number | null }>(
  issues: readonly T[],
  limits: { maxComments: number; maxResponseHours: number },
): { kept: T[]; relaxed: IssueGate[] } {
  const passes = (issue: T, relaxed: readonly IssueGate[]) =>
    (relaxed.includes('comments') || issue.comments <= limits.maxComments) &&
    (relaxed.includes('responsiveness') || (issue.responseHours !== null && issue.responseHours <= limits.maxResponseHours));
  const relaxed: IssueGate[] = [];
  let kept = issues.filter((issue) => passes(issue, relaxed));
  for (const gate of RELAX_ORDER) {
    if (kept.length > 0) break;
    relaxed.push(gate);
    kept = issues.filter((issue) => passes(issue, relaxed));
  }
  return { kept, relaxed: kept.length > 0 ? relaxed : [] };
}
