import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getProfileExtras, memberBadges, traitsFromBadges } from './badges';

let database: TestDatabase;
let uni: string;
let counter = 0;

async function member(): Promise<{ id: string; githubId: number; login: string }> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const githubId = 990_000 + counter;
  const login = `badge-${counter}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${uni}, now())`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${githubId}, ${login})`;
  return { id, githubId, login };
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Badge Uni', 'badge-uni', 'Testland', 'TL', '{}', 'admin', 'b') returning id`;
  uni = row!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('memberBadges', () => {
  it('earns reviewer, reviver, streak and open-source badges from the member’s own record', async () => {
    const [someone, author, partner, owner] = [await member(), await member(), await member(), await member()];
    // A helpful review.
    const [request] = await database.sql<{ id: string }[]>`
      insert into review_requests (author_user_id, university_id, pr_url, repo_full_name, pr_number, languages, status, expires_at)
      values (${author.id}, ${uni}, 'https://github.com/a/b/pull/1', 'a/b', 1, '{}', 'settled_helpful', now()) returning id`;
    await database.sql`insert into reviews (request_id, reviewer_user_id, gh_review_ids, line_comment_count, verified_at, rating)
                       values (${request!.id}, ${someone.id}, '{1}', 3, now(), 'helpful')`;
    // A revived adoption of someone else's listing.
    await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, is_fork, fetched_at)
                       values (5550001, ${owner.githubId}, ${`${owner.login}/old`}, 'old', false, now())`;
    const [listing] = await database.sql<{ id: string }[]>`
      insert into graveyard_listings (repo_github_id, owner_user_id, status) values (5550001, ${owner.id}, 'adopted') returning id`;
    await database.sql`insert into adoptions (listing_id, repo_github_id, adopter_user_id, status, fork_full_name, revived_at)
                       values (${listing!.id}, 5550001, ${someone.id}, 'revived', ${`${someone.login}/old`}, now())`;
    // A shared streak past the first companion stage (3 days by default).
    const [a, b] = [someone.id, partner.id].sort();
    await database.sql`insert into pairs (user_a, user_b, current_streak, longest_streak) values (${a!}, ${b!}, 2, 5)`;
    // Merged open-source work.
    await database.sql`insert into oss_member_contribs (user_id, repo_full_name, merged_prs, refreshed_at) values (${someone.id}, 'x/y', 2, now()), (${someone.id}, 'z/w', 1, now())`;

    const badges = await memberBadges(someone.id, uni);
    expect(badges.reviewer).toMatchObject({ helpful: 1 });
    expect(badges.reviver).toMatchObject([{ fullName: `${owner.login}/old`, forkFullName: `${someone.login}/old`, role: 'adopter' }]);
    expect(badges.streak).toEqual({ longest: 5 });
    expect(badges.oss).toEqual({ projects: 2, mergedPrs: 3 });
    expect(traitsFromBadges(badges)).toEqual(['reviewer', 'reviver', 'streak', 'oss']);

    // The listing's owner shares the revival; the partner's streak counts for them too.
    expect((await memberBadges(owner.id, uni)).reviver).toMatchObject([{ role: 'owner' }]);
    expect((await memberBadges(partner.id, uni)).streak).toEqual({ longest: 5 });
  });

  it('gives nothing to a member who has not earned anything, and short streaks no badge', async () => {
    const [newcomer, partner] = [await member(), await member()];
    const [a, b] = [newcomer.id, partner.id].sort();
    await database.sql`insert into pairs (user_a, user_b, current_streak, longest_streak) values (${a!}, ${b!}, 1, 2)`;
    const badges = await memberBadges(newcomer.id, uni);
    expect(badges).toEqual({ reviewer: null, reviver: null, streak: null, oss: null });
    expect(traitsFromBadges(badges)).toEqual([]);
    expect(await getProfileExtras({ userId: newcomer.id, universityId: uni })).toEqual({ badges, showcase: [] });
    expect((await memberBadges(newcomer.id, null)).reviewer).toBeNull();
  });
});
