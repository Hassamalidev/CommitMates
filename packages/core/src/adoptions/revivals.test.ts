import { createMswServer } from '@commitmates/config/testing/msw';
import { hasRevivalBadge, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import { memberTraits } from '../persona/service';

import { relistRepo, trackAdoption } from './revivals';

const API = 'https://api.github.com';
const DAY_MS = 86_400_000;
const server = createMswServer();
let database: TestDatabase;
let counter = 0;

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'core' });
const commit = (sha: string, date: string) => ({ sha, commit: { message: sha, author: { name: 'A', email: null, date } }, author: null, parents: [{ sha: 'p' }] });
const options = () => ({ now: () => new Date(), deadline: Date.now() + 30_000 });

type Person = { id: string; login: string; githubId: number };

async function member(): Promise<Person> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `reviver-${counter}`;
  await database.sql`insert into profiles (user_id, timezone, verified_at) values (${id}, 'UTC', now())`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${770_000 + counter}, ${login})`;
  return { id, login, githubId: 770_000 + counter };
}

/** A repository of `owner`, listed and adopted by `adopter` (accepted `activatedDaysAgo` days ago). */
async function adopted(owner: Person, adopter: Person, input: { fork?: string; activatedDaysAgo?: number; status?: string } = {}) {
  counter += 1;
  const repoId = 9_000_000 + counter;
  const name = `project-${counter}`;
  await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, is_fork, fetched_at)
                     values (${repoId}, ${owner.githubId}, ${`${owner.login}/${name}`}, ${name}, false, now())`;
  const [listing] = await database.sql<{ id: string }[]>`
    insert into graveyard_listings (repo_github_id, owner_user_id, status) values (${repoId}, ${owner.id}, ${input.status === 'requested' ? 'listed' : 'adopted'}) returning id`;
  const activated = input.status === 'requested' ? null : new Date(Date.now() - (input.activatedDaysAgo ?? 1) * DAY_MS);
  const [adoption] = await database.sql<{ id: string }[]>`
    insert into adoptions (listing_id, repo_github_id, adopter_user_id, status, fork_full_name, created_at, activated_at)
    values (${listing!.id}, ${repoId}, ${adopter.id}, ${input.status ?? 'active'}, ${input.fork ?? null},
            ${new Date((activated ?? new Date()).getTime() - DAY_MS)}, ${activated})
    returning id`;
  return { adoptionId: adoption!.id, listingId: listing!.id, repoId, name, fullName: `${owner.login}/${name}` };
}

const status = async (adoptionId: string) => (await database.sql<{ status: string; fork_full_name: string | null }[]>`
  select status, fork_full_name from adoptions where id = ${adoptionId}`)[0];
const notices = (userId: string) => database.sql<{ kind: string; data: { role: string; repo: string } }[]>`
  select kind, data from notifications where user_id = ${userId} order by created_at`;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearHandlers();
});
beforeEach(() => {
  resetGitHubClientState();
  server.use(http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() } } })));
});

describe('trackAdoption', () => {
  it('revives an adoption whose fork has enough new commits, notifies both and gives both the reviver trait', async () => {
    const [owner, adopter] = [await member(), await member()];
    const fork = `${adopter.login}/fork-a`;
    const { adoptionId, fullName } = await adopted(owner, adopter, { fork });
    const since: string[] = [];
    server.use(
      http.get(`${API}/repos/${adopter.login}/fork-a/commits`, ({ request }) => {
        since.push(new URL(request.url).searchParams.get('since') ?? '');
        return HttpResponse.json([commit('c', new Date().toISOString()), commit('b', new Date().toISOString()), commit('a', new Date().toISOString())], { headers: headers() });
      }),
    );
    expect(await memberTraits(adopter.githubId)).toEqual([]);
    expect(await trackAdoption(adoptionId, options())).toBe('revived');
    expect(since[0]).not.toBe('');
    expect(await status(adoptionId)).toMatchObject({ status: 'revived' });
    expect(await notices(adopter.id)).toMatchObject([{ kind: 'adoption_revived', data: { role: 'adopter', repo: fullName } }]);
    expect(await notices(owner.id)).toMatchObject([{ kind: 'adoption_revived', data: { role: 'owner', repo: fullName } }]);
    expect(await memberTraits(adopter.githubId)).toEqual(['reviver']);
    expect(await hasRevivalBadge(owner.githubId)).toBe(true);
    // Revived adoptions are no longer tracked.
    expect(await trackAdoption(adoptionId, options())).toBe('untracked');
  });

  it('finds the adopter’s fork among the repository’s forks and keeps waiting while commits are few', async () => {
    const [owner, adopter] = [await member(), await member()];
    const { adoptionId, name } = await adopted(owner, adopter);
    server.use(
      http.get(`${API}/repos/${owner.login}/${name}/forks`, () =>
        HttpResponse.json(
          [
            { full_name: `someone-else/${name}`, owner: { login: 'someone-else' }, created_at: null },
            { full_name: `${adopter.login.toUpperCase()}/my-copy`, owner: { login: adopter.login.toUpperCase() }, created_at: null },
          ],
          { headers: headers() },
        ),
      ),
      http.get(`${API}/repos/${adopter.login.toUpperCase()}/my-copy/commits`, () => HttpResponse.json([commit('a', new Date().toISOString())], { headers: headers() })),
    );
    expect(await trackAdoption(adoptionId, options())).toBe('fork_found');
    expect(await status(adoptionId)).toMatchObject({ status: 'active', fork_full_name: `${adopter.login.toUpperCase()}/my-copy` });
    expect(await notices(adopter.id)).toEqual([]);
  });

  it('drops an adoption with no commits for adoptions.dropAfterDays, and the owner may list it again', async () => {
    const [owner, adopter] = [await member(), await member()];
    const fork = `${adopter.login}/quiet`;
    const { adoptionId, listingId, fullName } = await adopted(owner, adopter, { fork, activatedDaysAgo: 91 });
    server.use(
      http.get(`${API}/repos/${adopter.login}/quiet/commits`, () =>
        HttpResponse.json([commit('old', new Date(Date.now() - 95 * DAY_MS).toISOString())], { headers: headers() }),
      ),
    );
    await expect(relistRepo(owner, { listingId })).rejects.toMatchObject({ code: 'listings.not_dropped' });
    expect(await trackAdoption(adoptionId, options())).toBe('dropped');
    expect(await notices(owner.id)).toMatchObject([{ kind: 'adoption_dropped', data: { role: 'owner', repo: fullName } }]);
    expect((await database.sql`select status from graveyard_listings where id = ${listingId}`)[0]?.status).toBe('adopted');
    await expect(relistRepo(adopter, { listingId })).rejects.toMatchObject({ code: 'listings.not_dropped' });
    await relistRepo(owner, { listingId });
    expect((await database.sql`select status from graveyard_listings where id = ${listingId}`)[0]?.status).toBe('listed');
  });

  it('keeps an adoption with recent commits even when it began long ago', async () => {
    const [owner, adopter] = [await member(), await member()];
    const { adoptionId } = await adopted(owner, adopter, { fork: `${adopter.login}/busy`, activatedDaysAgo: 120 });
    server.use(
      http.get(`${API}/repos/${adopter.login}/busy/commits`, () => HttpResponse.json([commit('new', new Date(Date.now() - 10 * DAY_MS).toISOString())], { headers: headers() })),
    );
    expect(await trackAdoption(adoptionId, options())).toBe('waiting');
    expect(await status(adoptionId)).toMatchObject({ status: 'active' });
  });

  it('ends a listing request the owner declined, quietly, and waits on one still pending', async () => {
    const [owner, adopter] = [await member(), await member()];
    const declined = await adopted(owner, adopter, { status: 'requested' });
    const pending = await adopted(owner, adopter, { status: 'requested' });
    for (const [entry, state] of [
      [declined, 'declined'],
      [pending, 'pending'],
    ] as const) {
      await database.sql`insert into message_requests (from_user, to_user, context_kind, context_id, first_message, status)
                         values (${adopter.id}, ${owner.id}, 'adoption', ${entry.adoptionId}, 'Hello there, may I adopt this?', ${state})`;
    }
    expect(await trackAdoption(declined.adoptionId, options())).toBe('dropped');
    expect(await trackAdoption(pending.adoptionId, options())).toBe('waiting');
    expect(await notices(adopter.id)).toEqual([]);
  });

  it('starts an adoption asked for from a global result once its fork appears, reading the repository by id', async () => {
    const adopter = await member();
    counter += 1;
    const repoId = 9_500_000 + counter;
    const [row] = await database.sql<{ id: string }[]>`
      insert into adoptions (repo_github_id, adopter_user_id) values (${repoId}, ${adopter.id}) returning id`;
    server.use(
      http.get(`${API}/repositories/${repoId}`, () =>
        HttpResponse.json({ id: repoId, full_name: 'stranger/tool', private: false, fork: false, size: 1, default_branch: 'main' }, { headers: headers() }),
      ),
      http.get(`${API}/repos/stranger/tool/forks`, () => HttpResponse.json([{ full_name: `${adopter.login}/tool`, owner: { login: adopter.login } }], { headers: headers() })),
      http.get(`${API}/repos/${adopter.login}/tool/commits`, () => HttpResponse.json([], { headers: headers() })),
    );
    expect(await trackAdoption(row!.id, options())).toBe('fork_found');
    const [adoption] = await database.sql<{ status: string; activated_at: Date | null }[]>`select status, activated_at from adoptions where id = ${row!.id}`;
    expect(adoption?.status).toBe('active');
    expect(adoption?.activated_at).not.toBeNull();
  });

  it('drops an old request from a global result with no fork, quietly', async () => {
    const adopter = await member();
    counter += 1;
    const repoId = 9_600_000 + counter;
    const [row] = await database.sql<{ id: string }[]>`
      insert into adoptions (repo_github_id, adopter_user_id, created_at) values (${repoId}, ${adopter.id}, now() - interval '100 days') returning id`;
    server.use(http.get(`${API}/repositories/${repoId}`, () => HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: headers() })));
    expect(await trackAdoption(row!.id, options())).toBe('dropped');
    expect(await notices(adopter.id)).toEqual([]);
  });
});

describe('track_revivals', () => {
  it('queues one check per tracked adoption and day', async () => {
    await database.sql`update adoptions set status = 'dropped' where status in ('requested', 'active')`;
    const [owner, adopter] = [await member(), await member()];
    const { adoptionId } = await adopted(owner, adopter, { fork: `${adopter.login}/queued` });
    await adopted(owner, adopter, { status: 'requested' });
    server.use(http.get(`${API}/repos/${adopter.login}/queued/commits`, () => HttpResponse.json([], { headers: headers() })));
    await database.sql`update job_schedules set next_run_at = now() - interval '1 minute', enabled = (name = 'track-revivals')`;
    await runTick({ budgetMs: 10_000 });
    await database.sql`update job_schedules set next_run_at = now() - interval '1 minute' where name = 'track-revivals'`;
    await runTick({ budgetMs: 10_000 });
    const queued = await database.sql<{ payload: { adoptionId: string } }[]>`
      select payload from jobs where type = 'track_revivals' and payload ? 'adoptionId'`;
    expect(queued).toHaveLength(2);
    expect(queued.map((job) => job.payload.adoptionId)).toContain(adoptionId);
  });
});
