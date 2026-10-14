import {
  commitUnfinishedSignal,
  evaluateRecruiterRules,
  hasExternalLink,
  messageTokens,
  normalizeCommitMessage,
  readmeUnfinishedSignal,
  recruiterScore,
  termMatcher,
  unfinishedScore,
  type RecruiterFacts,
  type RuleResult,
  type ShowcaseRepo,
} from '@commitmates/algorithms';
import { countGenericMessages, getDb, getSetting, latestSecretScan, topGenericMessages, type LatestSecretScan } from '@commitmates/db';
import { fetchReadme, type GitHubClient, type ProfileRepo } from '@commitmates/github';
import { loadAliasMap, normalizeTag, type AliasMap } from '@commitmates/sources';

import type { ProfileSnapshot } from '../profiles/ingest';
import type { DevCard } from '../persona/schemas';


/** The repositories a recruiter sees first: pinned ones the person owns, else the top ones by stars. */
export function showcaseRepos(snapshot: ProfileSnapshot, limit: number): { repos: ProfileRepo[]; usedTop: boolean } {
  const byId = new Map(snapshot.profile.repos.map((repo) => [repo.githubId, repo]));
  const pinned = snapshot.profile.pinnedRepoIds.flatMap((id) => byId.get(id) ?? []);
  if (pinned.length > 0) return { repos: pinned, usedTop: false };
  const top = [...snapshot.profile.repos].sort((a, b) => b.stars - a.stars || a.fullName.localeCompare(b.fullName)).slice(0, limit);
  return { repos: top, usedTop: true };
}

const toSkill = (raw: string, aliases: AliasMap): string | null => {
  const tag = normalizeTag(raw);
  return tag === null ? null : (aliases.get(tag) ?? tag);
};

export type RecruiterContext = { client: GitHubClient; deadline?: number };

/**
 * Reads what the rules need beyond the profile (CLAUDE.md §8 F3 "Data"): the profile README,
 * the README of each showcased repository, and the most common short commit messages.
 */
export async function gatherRecruiterFacts(
  snapshot: ProfileSnapshot,
  card: DevCard,
  resumeSkills: readonly string[],
  context: RecruiterContext,
): Promise<{ facts: RecruiterFacts; usedTop: boolean }> {
  const { profile } = snapshot;
  const request = context.deadline === undefined ? {} : { deadline: context.deadline };
  const [pinnedMax, topK, minTokens, unfinishedTerms] = await Promise.all([
    getSetting('recruiter.pinned.max'),
    getSetting('recruiter.genericMessageTopK'),
    getSetting('recruiter.minMessageTokens'),
    getSetting('graveyard.unfinishedTerms'),
  ]);
  const terms = termMatcher(unfinishedTerms);

  const profileReadme = await fetchReadme(context.client, profile.login, profile.login, request);
  const { repos, usedTop } = showcaseRepos(snapshot, pinnedMax);

  const showcase: ShowcaseRepo[] = [];
  const unfinishedScores: (number | null)[] = [];
  for (const repo of repos) {
    const [owner, name] = repo.fullName.split('/');
    const readme = owner && name ? ((await fetchReadme(context.client, owner, name, request)) ?? '') : '';
    showcase.push({
      readmeChars: readme.length,
      hasDemo: Boolean(repo.homepage) || hasExternalLink(readme),
      hasLicense: repo.licenseSpdx !== null,
      hasDescription: Boolean(repo.description?.trim()),
      hasTopics: repo.topics.length > 0,
    });
    const messages = snapshot.events.filter((event) => event.repo.toLowerCase() === repo.fullName.toLowerCase()).flatMap((event) => event.messages);
    unfinishedScores.push(unfinishedScore([readmeUnfinishedSignal(readme, terms), commitUnfinishedSignal(messages, terms)]));
  }

  const commitMessages = snapshot.events.flatMap((event) => event.messages);
  const genericMessages = await topGenericMessages(topK);
  // Short messages feed the shared counts that decide what is generic; nothing links them to anyone.
  await countGenericMessages(
    commitMessages.map(normalizeCommitMessage).filter((message) => {
      const tokens = messageTokens(message).length;
      return tokens > 0 && tokens <= minTokens + 2; // allowed-literal: "at most minMessageTokens + 2 tokens" (§8 F3)
    }),
  );

  const aliases = await loadAliasMap(getDb());
  const verifiedSkills = new Set(
    [...card.languages.map((language) => language.name), ...card.tags.map((tag) => tag.tag)].flatMap((value) => toSkill(value, aliases) ?? []),
  );
  return {
    usedTop,
    facts: {
      profileReadmeChars: profileReadme === null ? null : profileReadme.length,
      pinnedCount: snapshot.profile.pinnedRepoIds.length,
      showcase,
      showcaseSource: usedTop ? 'top' : 'pinned',
      commitMessages,
      genericMessages,
      unfinishedScores,
      resumeSkills: resumeSkills.flatMap((skill) => toSkill(skill, aliases) ?? []),
      verifiedSkills,
      activeDayShare: card.metrics.activeDayShare,
    },
  };
}

/** Scores the facts with the rule weights and thresholds in settings (CLAUDE.md §8 F3 "Rules", "Score"). */
export async function scoreRecruiterFacts(facts: RecruiterFacts): Promise<{ score: number | null; rules: RuleResult[] }> {
  const [weights, pinnedMin, pinnedMax, readmeMinChars, profileReadmeMinChars, minMessageTokens, activeDayTarget] = await Promise.all([
    getSetting('recruiter.weights'),
    getSetting('recruiter.pinned.min'),
    getSetting('recruiter.pinned.max'),
    getSetting('recruiter.readme.minChars'),
    getSetting('recruiter.profileReadme.minChars'),
    getSetting('recruiter.minMessageTokens'),
    getSetting('persona.marathoner.activeDayShare'),
  ]);
  const rules = evaluateRecruiterRules(facts, {
    weights,
    pinnedMin,
    pinnedMax,
    readmeMinChars,
    profileReadmeMinChars,
    minMessageTokens,
    activeDayTarget,
  });
  return { score: recruiterScore(rules), rules };
}

/** A member's latest secret scan of their own account. Callers pass the signed-in member's id. */
export function getOwnSecretScan(userId: string): Promise<LatestSecretScan | null> {
  return latestSecretScan(userId);
}
