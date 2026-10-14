import { createHash } from 'node:crypto';

import type { Contributor } from '@commitmates/algorithms';
import type { CommitSummary, ContributorStats } from '@commitmates/github';

const MS_PER_DAY = 86_400_000; // allowed-literal: unit conversion
const DAYS_PER_WEEK = 7; // allowed-literal: unit conversion
const MS_PER_WEEK = MS_PER_DAY * DAYS_PER_WEEK;
const MS_PER_SECOND = 1000; // allowed-literal: unit conversion
/** Characters of a SHA-256 hex digest kept in an email key: enough to tell people apart, not to recover the address. */
const EMAIL_KEY_LENGTH = 16;
/** Characters of an ISO timestamp that make up `YYYY-MM-DD`. */
const ISO_DATE_LENGTH = 10;

const CO_AUTHOR = /^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim;

/** A person without a GitHub account, keyed by a hash of their email so the address is never kept. */
export const emailKey = (email: string) => `email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, EMAIL_KEY_LENGTH)}`;

export const accountKey = (githubId: number) => `id:${githubId}`;

/** The person a commit belongs to. */
export function commitAuthorKey(commit: CommitSummary): string | null {
  if (commit.account) return accountKey(commit.account.githubId);
  return commit.authorEmail ? emailKey(commit.authorEmail) : null;
}

/** `Co-authored-by:` trailers of a commit message. */
export function coAuthors(message: string): { name: string; email: string }[] {
  return [...message.matchAll(CO_AUTHOR)].map(([, name = '', email = '']) => ({ name: name.trim(), email: email.trim() }));
}

/** Sunday 00:00 UTC of the week an instant falls in, as GitHub's statistics count weeks. */
export function weekStart(instant: Date): number {
  const day = Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
  return day - new Date(day).getUTCDay() * MS_PER_DAY;
}

export type CommitReading = {
  /** Net lines of each commit read in detail, outside excluded paths. */
  lines: ReadonlyMap<string, readonly [number, number]>;
  /** Lines in excluded paths per person. */
  excluded: ReadonlyMap<string, readonly [number, number]>;
  /** Distinct files per person, or `null` when not tracked. */
  files: ReadonlyMap<string, ReadonlySet<string>> | null;
};

export type AssembleInput = {
  stats: readonly ContributorStats[] | null;
  commits: readonly CommitSummary[];
  reading: CommitReading;
};

type Draft = Omit<Contributor, 'weekly'> & { weeks: Map<number, number> };

/**
 * Builds the people of a report (CLAUDE.md §8 F4 "Algorithm" steps 1–3). Accounts come from
 * GitHub's statistics when they exist, people without an account from the commit list; each
 * co-author gets one commit credit and an equal share of that commit's lines; lines in
 * vendored, generated or documentation paths are left out.
 */
export function assembleContributors(input: AssembleInput): { contributors: Contributor[]; weeks: string[]; coAuthorCredits: number } {
  const people = new Map<string, Draft>();
  const fromStats = input.stats !== null && input.stats.length > 0;
  const knownLines = (sha: string) => input.reading.lines.get(sha) ?? null;

  const draft = (key: string, base: Partial<Draft> & { name: string }): Draft => {
    let person = people.get(key);
    if (!person) {
      person = {
        key,
        login: null,
        avatarUrl: null,
        isBot: false,
        commits: 0,
        additions: 0,
        deletions: 0,
        filesTouched: null,
        weeks: new Map(),
        ...base,
      };
      people.set(key, person);
    }
    return person;
  };
  const addWeek = (person: Draft, week: number, commits: number) => {
    person.weeks.set(week, (person.weeks.get(week) ?? 0) + commits);
  };
  const addLines = (person: Draft, lines: readonly [number, number] | null) => {
    if (lines === null || person.additions === null || person.deletions === null) {
      person.additions = null;
      person.deletions = null;
      return;
    }
    person.additions += lines[0];
    person.deletions += lines[1];
  };

  // People whose lines come from GitHub's statistics, which include excluded paths.
  const statsKeys = new Set<string>();
  if (fromStats) {
    for (const entry of input.stats ?? []) {
      if (!entry.account) continue;
      statsKeys.add(accountKey(entry.account.githubId));
      const person = draft(accountKey(entry.account.githubId), {
        login: entry.account.login,
        name: entry.account.login,
        avatarUrl: entry.account.avatarUrl,
        isBot: entry.account.isBot,
      });
      person.commits += entry.total;
      for (const week of entry.weeks) {
        addLines(person, [week.additions, week.deletions]);
        if (week.commits > 0) addWeek(person, week.week * MS_PER_SECOND, week.commits);
      }
    }
  }

  // Emails seen on commits with an account, so a co-author trailer can find the account.
  const accountByEmail = new Map<string, Draft>();
  for (const commit of input.commits) {
    if (commit.account && commit.authorEmail) {
      const { login, githubId, avatarUrl, isBot } = commit.account;
      accountByEmail.set(commit.authorEmail.toLowerCase(), draft(accountKey(githubId), { login, name: login, avatarUrl, isBot }));
    }
  }

  let coAuthorCredits = 0;
  for (const commit of input.commits) {
    if (commit.isMerge) continue;
    const key = commitAuthorKey(commit);
    if (key === null) continue;
    const lines = knownLines(commit.sha);
    const author = draft(key, {
      login: commit.account?.login ?? null,
      name: commit.account?.login ?? commit.authorName ?? 'Unknown',
      avatarUrl: commit.account?.avatarUrl ?? null,
      isBot: commit.account?.isBot ?? false,
    });
    const week = commit.date ? weekStart(new Date(commit.date)) : null;
    // With statistics, accounts already carry their commits; the list adds everyone else.
    const counted = !fromStats || commit.account === null;
    if (counted) {
      author.commits += 1;
      if (week !== null) addWeek(author, week, 1);
      addLines(author, lines);
    }

    const partners = coAuthors(commit.message);
    for (const partner of partners) {
      const coAuthor =
        accountByEmail.get(partner.email.toLowerCase()) ?? draft(emailKey(partner.email), { name: partner.name || 'Unknown' });
      if (coAuthor.key === author.key) continue;
      coAuthorCredits += 1;
      coAuthor.commits += 1;
      if (week !== null) addWeek(coAuthor, week, 1);
      if (lines !== null) {
        const share: [number, number] = [lines[0] / (partners.length + 1), lines[1] / (partners.length + 1)];
        addLines(coAuthor, share);
        if (author.additions !== null && author.deletions !== null) {
          author.additions = Math.max(0, author.additions - share[0]);
          author.deletions = Math.max(0, author.deletions - share[1]);
        }
      }
    }
  }

  for (const [key, [additions, deletions]] of input.reading.excluded) {
    const person = people.get(key);
    // Lines read commit by commit are already net of excluded paths.
    if (!person || !statsKeys.has(key) || person.additions === null || person.deletions === null) continue;
    person.additions = Math.max(0, person.additions - additions);
    person.deletions = Math.max(0, person.deletions - deletions);
  }
  if (input.reading.files) {
    for (const person of people.values()) person.filesTouched = input.reading.files.get(person.key)?.size ?? 0;
  }

  const allWeeks = [...people.values()].flatMap((person) => [...person.weeks.keys()]);
  const first = allWeeks.length === 0 ? 0 : Math.min(...allWeeks);
  const last = allWeeks.length === 0 ? -1 : Math.max(...allWeeks);
  const weekStarts: number[] = [];
  for (let week = first; week <= last; week += MS_PER_WEEK) weekStarts.push(week);

  const contributors = [...people.values()]
    .filter((person) => person.commits > 0)
    .map(({ weeks, ...person }) => ({
      ...person,
      additions: person.additions === null ? null : Math.round(person.additions),
      deletions: person.deletions === null ? null : Math.round(person.deletions),
      weekly: weekStarts.map((week) => weeks.get(week) ?? 0),
    }))
    .sort((a, b) => b.commits - a.commits || (a.key < b.key ? -1 : 1));
  return {
    contributors,
    weeks: weekStarts.map((week) => new Date(week).toISOString().slice(0, ISO_DATE_LENGTH)),
    coAuthorCredits,
  };
}
