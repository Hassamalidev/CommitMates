import {
  getDb,
  getRepoDependencies,
  getRepoManifests,
  getSetting,
  isMemberGithubId,
  replaceRepoManifests,
  upsertGhRepos,
  upsertGhUser,
  type ManifestInput,
} from '@commitmates/db';
import {
  SERVER_IDENTITY,
  fetchFileText,
  fetchProfile,
  fetchPublicEvents,
  githubFor,
  listRootEntries,
  type ActivityEvent,
  type GitHubClient,
  type Profile,
  type ProfileRepo,
  type TokenIdentity,
} from '@commitmates/github';
import { isManifestFile, parseManifest, type Ecosystem } from '@commitmates/sources';

import { requestEnrichment } from '../sources/jobs';

const MS_PER_HOUR = 60 * 60 * 1000; // allowed-literal: unit conversion
const MS_PER_DAY = 24 * MS_PER_HOUR; // allowed-literal: unit conversion
/** GitHub's contribution calendar covers at most one year per query. */
const CONTRIBUTION_WINDOW_DAYS = 365;
/** Manifests larger than this are generated or vendored, not hand-written dependency lists. */
const MAX_MANIFEST_BYTES = 512_000;
/** Time kept in hand before the deadline so what was read can still be stored. */
const DEADLINE_MARGIN_MS = 5000;

export type RepoDependency = { repoGithubId: number; ecosystem: Ecosystem; name: string; isDev: boolean };

export type ProfileSnapshot = {
  profile: Profile;
  /** True when the account belongs to a signed-up member; their data carries no expiry. */
  isMember: boolean;
  events: ActivityEvent[];
  /** Dependencies of the repositories whose manifests were read. */
  dependencies: RepoDependency[];
  /** False when the deadline arrived before every manifest was read; a follow-up run finishes the rest. */
  manifestsComplete: boolean;
  fetchedAt: string;
};

export type IngestOptions = {
  /** The member's own identity when they analyze themselves; otherwise the server's (CLAUDE.md §5.6). */
  identity?: TokenIdentity;
  now?: Date;
  /** Epoch ms the caller must finish by. */
  deadline?: number;
};

const toDate = (value: string | null) => (value === null ? null : new Date(value));

async function storeProfile(profile: Profile, isMember: boolean, now: Date): Promise<void> {
  // People who have not signed up get a short-lived cache row and nothing else (CLAUDE.md §2.6).
  const ttlHours = await getSetting('privacy.nonUserRawTtlHours');
  const expiresAt = isMember ? null : new Date(now.getTime() + ttlHours * MS_PER_HOUR);

  await upsertGhUser({
    githubId: profile.githubId,
    login: profile.login,
    type: 'User',
    name: profile.name,
    locationRaw: profile.location,
    company: profile.company,
    blog: profile.blog,
    bio: profile.bio,
    followers: profile.followers,
    following: profile.following,
    publicRepos: profile.publicRepos,
    ghCreatedAt: new Date(profile.createdAt),
    isMember,
    fetchedAt: now,
    expiresAt,
  });
  await upsertGhRepos(
    profile.repos.map((repo) => ({
      githubId: repo.githubId,
      ownerGithubId: profile.githubId,
      fullName: repo.fullName,
      name: repo.name,
      description: repo.description,
      homepage: repo.homepage,
      topics: repo.topics,
      primaryLanguage: repo.primaryLanguage,
      languages: repo.languages,
      stars: repo.stars,
      forks: repo.forks,
      openIssues: repo.openIssues,
      licenseSpdx: repo.licenseSpdx,
      isFork: repo.isFork,
      isArchived: repo.isArchived,
      defaultBranch: repo.defaultBranch,
      sizeKb: repo.sizeKb,
      ghCreatedAt: new Date(repo.createdAt),
      pushedAt: toDate(repo.pushedAt),
      fetchedAt: now,
      expiresAt,
    })),
  );
}

/** Reads and stores the manifests in one repository's root. Unchanged files are not fetched again. */
async function ingestRepoManifests(client: GitHubClient, repo: ProfileRepo, now: Date, deadline: number | undefined): Promise<void> {
  const [owner, name] = repo.fullName.split('/');
  if (!owner || !name) return;

  const entries = await listRootEntries(client, owner, name, { deadline });
  const manifests = entries.filter(
    (entry) => entry.type === 'file' && isManifestFile(entry.name) && entry.size <= MAX_MANIFEST_BYTES,
  );
  const known = new Map((await getRepoManifests(repo.githubId)).map((row) => [row.path, row.blobSha]));
  const unchanged = manifests.length === known.size && manifests.every((entry) => known.get(entry.path) === entry.sha);
  if (unchanged) return;

  const parsed: ManifestInput[] = [];
  for (const entry of manifests) {
    const text = await fetchFileText(client, owner, name, entry.path, { deadline });
    const manifest = text === null ? null : parseManifest(entry.name, text);
    if (manifest) {
      parsed.push({ path: entry.path, ecosystem: manifest.ecosystem, blobSha: entry.sha, dependencies: manifest.dependencies });
    }
  }
  await replaceRepoManifests(repo.githubId, parsed, now);
}

/**
 * Fetches and stores everything the day-one tools need about one person
 * (CLAUDE.md §8 F1 "Data fetched"): profile, repositories, contribution calendar, recent
 * public events and the dependencies of their most recently pushed repositories.
 */
export async function ingestProfile(login: string, options: IngestOptions = {}): Promise<ProfileSnapshot> {
  const now = options.now ?? new Date();
  const client = githubFor(options.identity ?? SERVER_IDENTITY, { db: getDb(), now: () => now });
  const request = { deadline: options.deadline };

  const [repoCap, manifestRepos] = await Promise.all([getSetting('github.maxReposPerProfile'), getSetting('persona.manifestRepos')]);
  const profile = await fetchProfile(client, login, {
    ...request,
    repoCap,
    from: new Date(now.getTime() - CONTRIBUTION_WINDOW_DAYS * MS_PER_DAY),
    to: now,
  });
  const isMember = await isMemberGithubId(profile.githubId);
  await storeProfile(profile, isMember, now);

  // Events use the canonical login: GitHub redirects a renamed account, and the profile carries the new name.
  const events = await fetchPublicEvents(client, profile.login, request);

  const recent = [...profile.repos]
    .sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
    .slice(0, manifestRepos);
  let manifestsComplete = true;
  for (const repo of recent) {
    if (options.deadline !== undefined && Date.now() > options.deadline - DEADLINE_MARGIN_MS) {
      manifestsComplete = false;
      break;
    }
    await ingestRepoManifests(client, repo, now, options.deadline);
  }

  const rows = await getRepoDependencies(recent.map((repo) => repo.githubId));
  const dependencies: RepoDependency[] = rows.map((row) => ({
    repoGithubId: row.repoGithubId,
    ecosystem: row.ecosystem as Ecosystem,
    name: row.packageName,
    isDev: row.isDev,
  }));
  await requestEnrichment(
    dependencies.map((dependency) => ({ ecosystem: dependency.ecosystem, name: dependency.name })),
    now,
  );

  return { profile, isMember, events, dependencies, manifestsComplete, fetchedAt: now.toISOString() };
}
