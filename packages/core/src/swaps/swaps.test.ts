import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSwaps, proposeSwaps, respondToProposal, setOffers, setWants, swapSummary } from './service';

let database: TestDatabase;
let counter = 0;
const DAY_MS = 86_400_000;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`
    insert into topics (slug, display_name, aliases, related, blob_sha, synced_at)
    values ('react', 'React', '{}', '{}', 'a', now()), ('go', 'Go', '{}', '{}', 'b', now()), ('rust', 'Rust', '{}', '{}', 'c', now()),
           ('sql', 'SQL', '{}', '{}', 'd', now()), ('flutter', 'Flutter', '{}', '{}', 'e', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

async function university(): Promise<string> {
  counter += 1;
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values (${`Swap Uni ${counter}`}, ${`swap-uni-${counter}`}, 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  return row!.id;
}

type Person = { id: string; login: string; verified: boolean; universityId: string };

async function member(universityId: string, vector: Record<string, number>, options: { goals?: string[]; ghost?: boolean } = {}): Promise<Person> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `swapper-${counter}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, learning_goals, ghost_mode)
                     values (${id}, 'UTC', ${universityId}, now(), ${options.goals ?? []}, ${options.ghost ?? false})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${440_000 + counter}, ${login})`;
  await database.sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                     values (${id}, '{}', ${database.sql.json(vector)}, ${Object.keys(vector)}, '{}', now())`;
  return { id, login, verified: true, universityId };
}

const proposals = (universityId: string) =>
  database.sql<{ id: string; members: string[]; edges: { from: string; to: string; tag: string }[]; status: string }[]>`
    select id, members, edges, status from swap_proposals where university_id = ${universityId} order by created_at`;

describe('proposeSwaps', () => {
  it('pairs a member who teaches what another wants with one who teaches back, from verified offers and learning goals', async () => {
    const uni = await university();
    const ada = await member(uni, { react: 0.9 }, { goals: [] });
    const bo = await member(uni, { go: 0.8 }, { goals: ['react'] });
    await member(uni, { sql: 0.4 });
    await database.sql`insert into swap_wants (user_id, tag, priority) values (${ada.id}, 'go', 3)`;

    expect(await proposeSwaps(uni, new Date())).toEqual({ proposed: 1, expired: 0 });
    const [proposal] = await proposals(uni);
    expect(proposal?.members.sort()).toEqual([ada.id, bo.id].sort());
    expect(proposal?.edges).toEqual(
      expect.arrayContaining([
        { from: ada.id, to: bo.id, tag: 'react' },
        { from: bo.id, to: ada.id, tag: 'go' },
      ]),
    );
    expect((await database.sql`select kind from notifications where user_id = ${bo.id}`).map((row) => row.kind)).toEqual(['swap_proposed']);
    // Verified offers were written from the skill vectors.
    expect(await database.sql`select tag, verified from swap_offers where user_id = ${ada.id}`).toEqual([{ tag: 'react', verified: true }]);
    // Members in an open proposal wait for it to end before the next.
    expect(await proposeSwaps(uni, new Date())).toEqual({ proposed: 0, expired: 0 });
    // Past its deadline the proposal expires and they are proposed again.
    expect(await proposeSwaps(uni, new Date(Date.now() + 8 * DAY_MS))).toEqual({ proposed: 1, expired: 1 });
  });

  it('closes 3-cycles when swap.maxCycleLength allows, and never pairs across a block or with ghost mode', async () => {
    const uni = await university();
    const [a, b, c] = [await member(uni, { react: 0.9 }, { goals: ['sql'] }), await member(uni, { go: 0.9 }, { goals: ['react'] }), await member(uni, { sql: 0.9 }, { goals: ['go'] })];
    await withSettings({ 'swap.maxCycleLength': 2 }, async () => {
      expect((await proposeSwaps(uni, new Date())).proposed).toBe(0);
    });
    expect((await proposeSwaps(uni, new Date())).proposed).toBe(1);
    expect((await proposals(uni))[0]?.members).toHaveLength(3);
    expect(swapSummary((await proposals(uni))[0]!.edges, { [a.id]: a.login, [b.id]: b.login, [c.id]: c.login })).toMatch(/^Skill swap: @swapper-\d+ helps @swapper-\d+ with \w+; .+; .+\.$/);

    const blockedUni = await university();
    const x = await member(blockedUni, { react: 0.9 }, { goals: ['go'] });
    const y = await member(blockedUni, { go: 0.9 }, { goals: ['react'] });
    await database.sql`insert into blocks (blocker, blocked) values (${y.id}, ${x.id})`;
    expect((await proposeSwaps(blockedUni, new Date())).proposed).toBe(0);

    const ghostUni = await university();
    await member(ghostUni, { react: 0.9 }, { goals: ['go'] });
    await member(ghostUni, { go: 0.9 }, { goals: ['react'], ghost: true });
    expect((await proposeSwaps(ghostUni, new Date())).proposed).toBe(0);
  });
});

describe('answers', () => {
  async function proposed() {
    const uni = await university();
    const one = await member(uni, { react: 0.9 }, { goals: ['go'] });
    const two = await member(uni, { go: 0.9 }, { goals: ['react'] });
    await proposeSwaps(uni, new Date());
    const [proposal] = await proposals(uni);
    return { uni, one, two, proposalId: proposal!.id };
  }

  it('opens a swap group thread with who helps whom once everyone accepts', async () => {
    const { one, two, proposalId } = await proposed();
    expect(await respondToProposal(one, { proposalId, response: 'accept' })).toEqual({ status: 'proposed', threadId: null });
    const done = await respondToProposal(two, { proposalId, response: 'accept' });
    expect(done.status).toBe('accepted');
    const [thread] = await database.sql`select kind from threads where id = ${done.threadId}`;
    expect(thread?.kind).toBe('swap');
    expect((await database.sql`select user_id from thread_members where thread_id = ${done.threadId}`).length).toBe(2);
    const [message] = await database.sql<{ kind: string; body: string }[]>`select kind, body from messages where thread_id = ${done.threadId}`;
    expect(message?.kind).toBe('system');
    expect(message?.body).toContain(`@${one.login} helps @${two.login} with react`);
    const [a, b] = [one.id, two.id].sort();
    expect(await database.sql`select source from connections where user_a = ${a!} and user_b = ${b!}`).toEqual([{ source: 'swap' }]);
    await expect(respondToProposal(one, { proposalId, response: 'decline' })).rejects.toMatchObject({ code: 'swap.closed' });
  });

  it('ends a proposal on one decline, refuses outsiders, and expires late answers', async () => {
    const first = await proposed();
    const outsider = await member(first.uni, {});
    await expect(respondToProposal(outsider, { proposalId: first.proposalId, response: 'accept' })).rejects.toMatchObject({ code: 'swap.not_yours' });
    expect((await respondToProposal(first.one, { proposalId: first.proposalId, response: 'decline' })).status).toBe('declined');
    expect((await database.sql`select kind from notifications where user_id = ${first.two.id} order by created_at`).map((row) => row.kind)).toEqual(['swap_proposed', 'swap_declined']);

    const second = await proposed();
    await expect(respondToProposal(second.one, { proposalId: second.proposalId, response: 'accept' }, new Date(Date.now() + 8 * DAY_MS))).rejects.toMatchObject({
      code: 'swap.closed',
    });
    expect((await database.sql`select status from swap_proposals where id = ${second.proposalId}`)[0]?.status).toBe('expired');
  });
});

describe('offers and wants', () => {
  const open = <T,>(run: () => Promise<T>) => withSettings({ 'unlock.swap.minMembers': 1 }, run);

  it('stores self-declared offers from the vocabulary, keeps verified ones verified, and ranks wants', async () => {
    const uni = await university();
    const someone = await member(uni, { react: 0.9 }, { goals: ['rust'] });
    await withSettings({ 'unlock.swap.minMembers': 10_000 }, async () => {
      await expect(setOffers(someone, { selfDeclared: ['flutter'] })).rejects.toMatchObject({ code: 'swap.locked' });
    });
    await expect(open(() => setOffers(someone, { selfDeclared: ['not-a-real-skill'] }))).rejects.toMatchObject({ code: 'swap.unknown_tags' });
    expect(await open(() => setOffers(someone, { selfDeclared: ['Flutter', 'react'] }))).toEqual(['flutter']);
    await expect(open(() => setWants(someone, { wants: [{ tag: 'go', priority: 9 }] }))).rejects.toMatchObject({ code: 'swap.priority' });
    await open(() => setWants(someone, { wants: [{ tag: 'go', priority: '3' }, { tag: ' ', priority: 1 }] }));

    const view = await open(() => getSwaps(someone));
    expect(view.verifiedOffers.map((offer) => offer.tag)).toEqual(['react']);
    expect(view.selfDeclared).toEqual(['flutter']);
    expect(view.wants).toEqual([
      { tag: 'go', priority: 3, fromGoals: false },
      { tag: 'rust', priority: 2, fromGoals: true },
    ]);
    expect(view.rules).toEqual({ maxPriority: 3, maxSelfDeclared: 10, maxWants: 10, minTeachLevel: 0.5 });
  });
});
