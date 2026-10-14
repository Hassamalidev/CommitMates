import { ValidationError } from '@commitmates/db';
import { z } from 'zod';

import { RATE_LIMIT_FRAGMENT, type GitHubClient, type RequestOptions } from '../client';
import { GitHubNotFoundError } from '../errors';

/** GitHub returns at most this many nodes per connection page. */
const GRAPHQL_PAGE_MAX = 100;

const REPO_FIELDS = `
  databaseId name nameWithOwner description homepageUrl stargazerCount forkCount isFork isArchived
  pushedAt createdAt diskUsage
  defaultBranchRef { name }
  licenseInfo { spdxId }
  primaryLanguage { name }
  languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  issues(states: OPEN) { totalCount }`;

export const PROFILE_QUERY = `
query Profile($login: String!, $repoCount: Int!, $after: String, $from: DateTime!, $to: DateTime!) {
  repositoryOwner(login: $login) {
    __typename
    ... on User {
      databaseId login name location bio company websiteUrl avatarUrl createdAt
      followers { totalCount }
      following { totalCount }
      pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { databaseId } } }
      repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: $repoCount, after: $after,
                   orderBy: { field: PUSHED_AT, direction: DESC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {${REPO_FIELDS}
        }
      }
      contributionsCollection(from: $from, to: $to) {
        restrictedContributionsCount
        totalCommitContributions
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      }
    }
  }
  ${RATE_LIMIT_FRAGMENT}
}`;

const repoSchema = z.object({
  databaseId: z.number(),
  name: z.string(),
  nameWithOwner: z.string(),
  description: z.string().nullable(),
  homepageUrl: z.string().nullable(),
  stargazerCount: z.number(),
  forkCount: z.number(),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  pushedAt: z.string().nullable(),
  createdAt: z.string(),
  diskUsage: z.number().nullable(),
  defaultBranchRef: z.object({ name: z.string() }).nullable(),
  licenseInfo: z.object({ spdxId: z.string().nullable() }).nullable(),
  primaryLanguage: z.object({ name: z.string() }).nullable(),
  languages: z.object({ edges: z.array(z.object({ size: z.number(), node: z.object({ name: z.string() }) })).nullable() }).nullable(),
  repositoryTopics: z.object({ nodes: z.array(z.object({ topic: z.object({ name: z.string() }) })).nullable() }).nullable(),
  issues: z.object({ totalCount: z.number() }),
});

const userSchema = z.object({
  __typename: z.literal('User'),
  databaseId: z.number(),
  login: z.string(),
  name: z.string().nullable(),
  location: z.string().nullable(),
  bio: z.string().nullable(),
  company: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  avatarUrl: z.string(),
  createdAt: z.string(),
  followers: z.object({ totalCount: z.number() }),
  following: z.object({ totalCount: z.number() }),
  pinnedItems: z.object({ nodes: z.array(z.object({ databaseId: z.number().optional() }).nullable()).nullable() }),
  repositories: z.object({
    totalCount: z.number(),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    nodes: z.array(repoSchema.nullable()).nullable(),
  }),
  contributionsCollection: z.object({
    restrictedContributionsCount: z.number(),
    totalCommitContributions: z.number(),
    contributionCalendar: z.object({
      totalContributions: z.number(),
      weeks: z.array(z.object({ contributionDays: z.array(z.object({ date: z.string(), contributionCount: z.number() })) })),
    }),
  }),
});

const responseSchema = z.object({
  repositoryOwner: z.union([userSchema, z.object({ __typename: z.string() })]).nullable(),
});

export type ProfileRepo = {
  githubId: number;
  name: string;
  fullName: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  isFork: boolean;
  isArchived: boolean;
  pushedAt: string | null;
  createdAt: string;
  sizeKb: number | null;
  defaultBranch: string | null;
  licenseSpdx: string | null;
  primaryLanguage: string | null;
  /** `{ language: bytes }` */
  languages: Record<string, number>;
  topics: string[];
  openIssues: number;
};

export type Profile = {
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  location: string | null;
  bio: string | null;
  company: string | null;
  blog: string | null;
  createdAt: string;
  followers: number;
  following: number;
  /** Public, non-fork repositories the account owns, as counted by GitHub. */
  publicRepos: number;
  pinnedRepoIds: number[];
  repos: ProfileRepo[];
  /** True when the account owns more repositories than were read (`github.maxReposPerProfile`). */
  reposTruncated: boolean;
  contributions: {
    total: number;
    /** Private contributions GitHub counts when the account has enabled showing them. */
    restricted: number;
    totalCommits: number;
    days: { date: string; count: number }[];
  };
};

/** Thrown when a login belongs to an organization: the tools that use profiles are about people. */
export class GitHubOrganizationError extends ValidationError {
  constructor() {
    super('github.organization', "That's an organization, not a person.");
  }
}

// GitHub reports "no license detected" as this pseudo identifier.
const NO_LICENSE = 'NOASSERTION';

function toRepo(node: z.infer<typeof repoSchema>): ProfileRepo {
  const languages: Record<string, number> = {};
  for (const edge of node.languages?.edges ?? []) languages[edge.node.name] = edge.size;
  const spdx = node.licenseInfo?.spdxId ?? null;
  return {
    githubId: node.databaseId,
    name: node.name,
    fullName: node.nameWithOwner,
    description: node.description,
    homepage: node.homepageUrl === '' ? null : node.homepageUrl,
    stars: node.stargazerCount,
    forks: node.forkCount,
    isFork: node.isFork,
    isArchived: node.isArchived,
    pushedAt: node.pushedAt,
    createdAt: node.createdAt,
    sizeKb: node.diskUsage,
    defaultBranch: node.defaultBranchRef?.name ?? null,
    licenseSpdx: spdx === NO_LICENSE ? null : spdx,
    primaryLanguage: node.primaryLanguage?.name ?? null,
    languages,
    topics: (node.repositoryTopics?.nodes ?? []).map((entry) => entry.topic.name),
    openIssues: node.issues.totalCount,
  };
}

export type FetchProfileOptions = RequestOptions & {
  /** Most repositories to read (`github.maxReposPerProfile`). */
  repoCap: number;
  /** Contribution window. GitHub accepts at most one year. */
  from: Date;
  to: Date;
};

/**
 * Reads a person's public profile, owned repositories and contribution calendar
 * (CLAUDE.md §8 F1, steps 1–3). Organizations are rejected; unknown logins are not found.
 */
export async function fetchProfile(client: GitHubClient, login: string, options: FetchProfileOptions): Promise<Profile> {
  const repos: ProfileRepo[] = [];
  let after: string | null = null;
  let profile: Omit<Profile, 'repos' | 'reposTruncated'> | null = null;
  let hasMore = true;

  while (hasMore && repos.length < options.repoCap) {
    const data: z.infer<typeof responseSchema> = await client.graphql(
      PROFILE_QUERY,
      {
        login,
        repoCount: Math.min(GRAPHQL_PAGE_MAX, options.repoCap - repos.length),
        after,
        from: options.from.toISOString(),
        to: options.to.toISOString(),
      },
      responseSchema,
      { ...options, what: `@${login}` },
    );
    const owner = data.repositoryOwner;
    if (owner === null) throw new GitHubNotFoundError(`@${login}`);
    if (owner.__typename !== 'User') throw new GitHubOrganizationError();
    const user = userSchema.parse(owner);

    profile ??= {
      githubId: user.databaseId,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      location: user.location,
      bio: user.bio,
      company: user.company,
      blog: user.websiteUrl === '' ? null : user.websiteUrl,
      createdAt: user.createdAt,
      followers: user.followers.totalCount,
      following: user.following.totalCount,
      publicRepos: user.repositories.totalCount,
      pinnedRepoIds: (user.pinnedItems.nodes ?? []).flatMap((node) => (node?.databaseId === undefined ? [] : [node.databaseId])),
      contributions: {
        total: user.contributionsCollection.contributionCalendar.totalContributions,
        restricted: user.contributionsCollection.restrictedContributionsCount,
        totalCommits: user.contributionsCollection.totalCommitContributions,
        days: user.contributionsCollection.contributionCalendar.weeks.flatMap((week) =>
          week.contributionDays.map((day) => ({ date: day.date, count: day.contributionCount })),
        ),
      },
    };
    for (const node of user.repositories.nodes ?? []) {
      if (node !== null) repos.push(toRepo(node));
    }
    hasMore = user.repositories.pageInfo.hasNextPage;
    after = user.repositories.pageInfo.endCursor;
    if (after === null) break;
  }

  if (profile === null) throw new GitHubNotFoundError(`@${login}`);
  return { ...profile, repos, reposTruncated: hasMore };
}
