import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { respondToRequest } from '../chat/threads';
import { graveyardResultSchema } from '../graveyard/schemas';
import { registerAllHandlers } from '../handlers';
import { registerAllTools } from '../tools/definitions';
import { clearTools, loadToolResult, startToolRun } from '../tools/service';

import { getAdoptions, linkFork, recordAdoptionInterest, requestAdoption } from './flow';
import { listRepo } from './listings';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let uniA: string;
let uniB: string;
let counter = 0;

const MESSAGE = 'Hi! I would love to pick up your project and finish the frontend this term.';
const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'core' });

type Person = { id: string; login: string; githubId: number; verified: boolean; universityId: string };

async function member(universityId: string): Promise<Person> {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  const login = `adopt-${n}`;
  await database.sql`update users set created_at = now() - interval '30 days' where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${universityId}, now())`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${880_000 + n}, ${login})`;
  return { id, login, githubId: 880_000 + n, verified: true, universityId };
}

/** A listed repository of `owner`, about React, with no license. */
async function listed(owner: Person, name: string): Promise<{ listingId: string; repoId: number }> {
  const repoId = owner.githubId * 10 + counter;
  await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, is_fork, stars, pushed_at, fetched_at)
                     values (${repoId}, ${owner.githubId}, ${`${owner.login}/${name}`}, ${name}, 'A react dashboard', '{react}', false, 12, now() - interval '200 days', now())`;
  const listingId = await listRepo(owner, { repoGithubId: repoId, note: 'Needs a frontend' });
  return { listingId, repoId };
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  registerAllTools();
  const rows = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni A', 'uni-a', 'Testland', 'TL', '{}', 'admin', 'a'), ('Uni B', 'uni-b', 'Testland', 'TL', '{}', 'admin', 'b') returning id`;
  uniA = rows[0]!.id;
  uniB = rows[1]!.id;
  // The search term's expansion is cached, so the search itself never asks GitHub to sample.
  await database.sql`
    insert into taxonomy_expansions (term, slug, items, sample_size, computed_at, expires_at)
    values ('react', 'react', ${database.sql.json([{ kind: 'topic', value: 'react', score: 1, source: 'alias' }])}, 10, now(), now() + interval '1 day')`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearTools();
  clearHandlers();
});
beforeEach(() => {
  resetGitHubClientState();
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() } } })),
    http.get(`${API}/repos/:owner/:repo/readme`, () => new HttpResponse('# Dashboard\nWork in progress', { headers: { ...headers(), 'content-type': 'text/plain' } })),
    http.get(`${API}/repos/:owner/:repo/contributors`, () => HttpResponse.json([{ contributions: 3 }], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/commits`, () => HttpResponse.json([{ commit: { message: 'WIP', author: { date: '2025-01-01T00:00:00Z' } } }], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/releases`, () => HttpResponse.json([], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/tags`, () => HttpResponse.json([], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/issues`, () => HttpResponse.json([], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/stargazers`, () => HttpResponse.json([], { headers: headers() })),
  );
});

async function searchUni(searcher: Person) {
  const run = await startToolRun('graveyard', { q: 'react', scope: 'uni' }, { userId: searcher.id });
  if (run.status === 'done') return graveyardResultSchema.parse(run.result);
  await runTick({ budgetMs: 30_000, onlyJobId: run.jobId });
  const [job] = await database.sql<{ status: string; result_ref: unknown; last_error: string | null }[]>`
    select status, result_ref, last_error from jobs where id = ${run.jobId}`;
  expect(job, job?.last_error ?? '').toMatchObject({ status: 'done' });
  return graveyardResultSchema.parse(await loadToolResult(job!.result_ref));
}

describe('the Graveyard uni tab', () => {
  it('finds listings at the searcher’s own university only, never their own, scored with the listing attached', async () => {
    const [owner, searcher, elsewhere] = [await member(uniA), await member(uniA), await member(uniB)];
    const { listingId } = await listed(owner, 'react-dash');
    await listed(searcher, 'my-own');
    await listed(elsewhere, 'far-away');

    const result = await searchUni(searcher);
    expect(result.items.map((item) => item.fullName)).toEqual([`${owner.login}/react-dash`]);
    // The owner opted in, so a short history does not hide it.
    expect(result.items[0]).toMatchObject({ listing: { id: listingId, note: 'Needs a frontend', ownerLogin: owner.login }, licenseSpdx: null });
    await expect(startToolRun('graveyard', { q: 'react', scope: 'uni' })).resolves.toMatchObject({ status: 'queued' });
  });
});

describe('adoption flow', () => {
  it('asks the owner through a message request, and accepting starts the adoption', async () => {
    const [owner, adopter] = [await member(uniA), await member(uniA)];
    const { listingId, repoId } = await listed(owner, 'to-adopt');
    const adoptionId = await requestAdoption(adopter, { listingId, message: MESSAGE });
    const [request] = await database.sql<{ id: string; context_kind: string; context_id: string }[]>`
      select id, context_kind, context_id from message_requests where from_user = ${adopter.id} and to_user = ${owner.id}`;
    expect(request).toMatchObject({ context_kind: 'adoption', context_id: adoptionId });
    await expect(requestAdoption(adopter, { listingId, message: MESSAGE })).rejects.toMatchObject({ code: 'adoptions.already_requested' });

    await respondToRequest(owner, { requestId: request!.id, accept: true });
    const [adoption] = await database.sql`select status, repo_github_id from adoptions where id = ${adoptionId}`;
    expect(adoption).toMatchObject({ status: 'active', repo_github_id: String(repoId) });
    const [listing] = await database.sql`select status from graveyard_listings where id = ${listingId}`;
    expect(listing?.status).toBe('adopted');
    const [a, b] = [owner.id, adopter.id].sort();
    expect(await database.sql`select source from connections where user_a = ${a!} and user_b = ${b!}`).toEqual([{ source: 'adoption' }]);

    // The adopter links a fork in their own account; the owner sees the adoption, without a license.
    await expect(linkFork(adopter, { adoptionId, fork: 'someone-else/to-adopt' })).rejects.toMatchObject({ code: 'adoptions.fork_not_yours' });
    expect(await linkFork(adopter, { adoptionId, fork: `https://github.com/${adopter.login}/to-adopt` })).toBe(`${adopter.login}/to-adopt`);
    expect((await getAdoptions(adopter)).adopting).toMatchObject([{ id: adoptionId, status: 'active', forkFullName: `${adopter.login}/to-adopt`, licenseSpdx: null }]);
    expect((await getAdoptions(owner)).adoptedFromMe.map((entry) => entry.listingId)).toEqual([listingId]);
  });

  it('refuses the owner’s own listing and listings at other universities', async () => {
    const [owner, outsider] = [await member(uniA), await member(uniB)];
    const { listingId } = await listed(owner, 'mine');
    await expect(requestAdoption(owner, { listingId, message: MESSAGE })).rejects.toMatchObject({ code: 'adoptions.own' });
    await expect(requestAdoption(outsider, { listingId, message: MESSAGE })).rejects.toMatchObject({ code: 'adoptions.listing_gone' });
    await expect(linkFork(outsider, { adoptionId: '0b6a8f2e-7c1d-4e5f-9a0b-1c2d3e4f5a6b', fork: `${outsider.login}/x` })).rejects.toMatchObject({
      code: 'adoptions.not_active',
    });
  });

  it('records interest in a global result once', async () => {
    const someone = await member(uniA);
    expect(await recordAdoptionInterest(someone, { repoGithubId: 123 })).toBe(true);
    expect(await recordAdoptionInterest(someone, { repoGithubId: 123 })).toBe(false);
    expect(await database.sql`select status, listing_id from adoptions where adopter_user_id = ${someone.id}`).toEqual([{ status: 'requested', listing_id: null }]);
  });
});
