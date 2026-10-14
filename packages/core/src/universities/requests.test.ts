import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { MemberRole } from '../profiles/schemas';

import { changeModerator, listReviewableRequests, requestUniversity, reviewRequest } from './requests';
import { matchEmailToUniversity } from './service';

let database: TestDatabase;
let uniTl: string;
let uniXy: string;

const reviewer = (id: string, roles: MemberRole[]) => ({ id, roles });

async function university(name: string, slug: string, code: string, country: string, domain: string): Promise<string> {
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values (${name}, ${slug}, ${country}, ${code}, '{}', 'hipo', 'x') returning id`;
  await database.sql`insert into university_domains (domain, university_id) values (${domain}, ${row!.id})`;
  return row!.id;
}

async function memberWithLogin(login: string, universityId: string | null = null, verified = false): Promise<string> {
  const userId = await insertTestUser(database.sql);
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${userId}, 'UTC', ${universityId}, ${verified ? new Date() : null})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${userId}, ${Math.floor(Math.random() * 1e9)}, ${login})`;
  return userId;
}

beforeAll(async () => {
  database = await useTestDatabase();
  uniTl = await university('Uni of Testland', 'uni-tl', 'TL', 'Testland', 'uni.edu');
  uniXy = await university('Xy Polytechnic', 'xy-poly-xy', 'XY', 'Xyland', 'xy.edu');
  await database.sql`insert into disposable_domains (domain, synced_at) values ('mailinator.com', now())`;
});
afterAll(async () => {
  await database.destroy();
});
beforeEach(async () => {
  await database.sql`truncate university_requests, notifications, audit_log`;
});

describe('requestUniversity', () => {
  it('records one open request per member and domain', async () => {
    const userId = await memberWithLogin('req-a');
    const first = await requestUniversity(userId, { domain: 'student@New-College.EDU', proposedName: 'New College', countryCode: 'tl' });
    const again = await requestUniversity(userId, { domain: 'new-college.edu', proposedName: 'New College', countryCode: 'TL' });
    expect(again.requestId).toBe(first.requestId);
    const rows = await database.sql`select domain, country_code, status from university_requests`;
    expect(rows).toEqual([{ domain: 'new-college.edu', country_code: 'TL', status: 'pending' }]);
  });

  it('refuses known, disposable and malformed domains, and countries without universities', async () => {
    const userId = await memberWithLogin('req-b');
    const base = { proposedName: 'Some College', countryCode: 'TL' };
    await expect(requestUniversity(userId, { ...base, domain: 'cs.uni.edu' })).rejects.toMatchObject({ code: 'universities.domain_known' });
    await expect(requestUniversity(userId, { ...base, domain: 'mailinator.com' })).rejects.toMatchObject({ code: 'universities.disposable' });
    await expect(requestUniversity(userId, { ...base, domain: 'nodot' })).rejects.toMatchObject({ code: 'universities.invalid_domain' });
    await expect(requestUniversity(userId, { ...base, domain: 'fine.edu', countryCode: 'ZZ' })).rejects.toMatchObject({ field: 'countryCode' });
  });
});

describe('reviewing requests', () => {
  it('lets an admin create a university, after which the domain verifies by email', async () => {
    const requester = await memberWithLogin('req-c');
    const admin = await memberWithLogin('admin-a');
    const { requestId } = await requestUniversity(requester, { domain: 'brand-new.edu', proposedName: 'Brand New University', countryCode: 'TL' });
    expect(await listReviewableRequests(reviewer(admin, [{ role: 'admin', universityId: null }]))).toHaveLength(1);

    const outcome = await reviewRequest(reviewer(admin, [{ role: 'admin', universityId: null }]), {
      decision: 'create',
      requestId,
      name: 'Brand New University',
      countryCode: 'TL',
    });
    expect(outcome).toMatchObject({ status: 'reviewed', universityName: 'Brand New University' });
    const [created] = await database.sql`select slug, source, country from universities where name = 'Brand New University'`;
    expect(created).toEqual({ slug: 'brand-new-university-tl', source: 'admin', country: 'Testland' });
    expect(await matchEmailToUniversity('ada@cs.brand-new.edu')).toMatchObject({ status: 'matched' });

    const [notification] = await database.sql`select user_id, kind, data from notifications`;
    expect(notification).toMatchObject({ user_id: requester, kind: 'university_request_approved', data: { domain: 'brand-new.edu', universityName: 'Brand New University' } });
    const audit = await database.sql`select actor_user_id, action from audit_log`;
    expect(audit).toEqual([{ actor_user_id: admin, action: 'university_request.create' }]);
    // A handled request cannot be reviewed twice.
    await expect(reviewRequest(reviewer(admin, [{ role: 'admin', universityId: null }]), { decision: 'reject', requestId })).rejects.toMatchObject({
      code: 'universities.request_not_found',
    });
  });

  it('lets a moderator add a domain to their own university and reject within their country only', async () => {
    const requester = await memberWithLogin('req-d');
    const moderator = await memberWithLogin('mod-a', uniTl, true);
    const asModerator = reviewer(moderator, [{ role: 'uni_moderator', universityId: uniTl }]);
    const tl = await requestUniversity(requester, { domain: 'uni-mail.edu', proposedName: 'Uni of Testland', countryCode: 'TL' });
    const xy = await requestUniversity(requester, { domain: 'xy-alt.edu', proposedName: 'Xy Polytechnic', countryCode: 'XY' });

    expect((await listReviewableRequests(asModerator)).map((request) => request.domain)).toEqual(['uni-mail.edu']);
    await expect(reviewRequest(asModerator, { decision: 'create', requestId: tl.requestId, name: 'Uni', countryCode: 'TL' })).rejects.toMatchObject({
      code: 'universities.review_forbidden',
    });
    await expect(reviewRequest(asModerator, { decision: 'attach', requestId: tl.requestId, universityId: uniXy })).rejects.toMatchObject({
      code: 'universities.review_forbidden',
    });
    await expect(reviewRequest(asModerator, { decision: 'reject', requestId: xy.requestId })).rejects.toMatchObject({ code: 'universities.review_forbidden' });

    await reviewRequest(asModerator, { decision: 'attach', requestId: tl.requestId, universityId: uniTl });
    expect(await matchEmailToUniversity('ada@uni-mail.edu')).toMatchObject({ status: 'matched', universities: [{ id: uniTl }] });
  });

  it('records the note when a request is rejected', async () => {
    const requester = await memberWithLogin('req-e');
    const admin = await memberWithLogin('admin-b');
    const { requestId } = await requestUniversity(requester, { domain: 'maybe.edu', proposedName: 'Maybe College', countryCode: 'TL' });
    await reviewRequest(reviewer(admin, [{ role: 'admin', universityId: null }]), { decision: 'reject', requestId, note: 'This is a company domain.' });
    const [row] = await database.sql`select status, note, reviewed_by from university_requests where id = ${requestId}`;
    expect(row).toEqual({ status: 'rejected', note: 'This is a company domain.', reviewed_by: admin });
    const [notification] = await database.sql`select kind from notifications`;
    expect(notification?.kind).toBe('university_request_rejected');
  });
});

describe('changeModerator', () => {
  it('grants only to verified members of that university, and revokes, with an audit trail', async () => {
    const admin = reviewer(await memberWithLogin('admin-c'), [{ role: 'admin', universityId: null }]);
    const verified = await memberWithLogin('mod-b', uniTl, true);
    await memberWithLogin('unverified-c', uniTl, false);

    await expect(changeModerator(admin, { login: 'unverified-c', universityId: uniTl, grant: true })).rejects.toMatchObject({ code: 'roles.not_verified_here' });
    await expect(changeModerator(admin, { login: 'mod-b', universityId: uniXy, grant: true })).rejects.toMatchObject({ code: 'roles.not_verified_here' });
    await expect(changeModerator(admin, { login: 'nobody', universityId: uniTl, grant: true })).rejects.toMatchObject({ code: 'roles.unknown_member' });

    expect(await changeModerator(admin, { login: '@mod-b', universityId: uniTl, grant: true })).toEqual({ changed: true });
    expect(await changeModerator(admin, { login: 'mod-b', universityId: uniTl, grant: true })).toEqual({ changed: false });
    expect(await database.sql`select role, university_id from roles where user_id = ${verified}`).toEqual([{ role: 'uni_moderator', university_id: uniTl }]);
    expect(await changeModerator(admin, { login: 'mod-b', universityId: uniTl, grant: false })).toEqual({ changed: true });
    expect(await database.sql`select 1 from roles where user_id = ${verified}`).toHaveLength(0);
    const audit = await database.sql`select action from audit_log where target_id = ${verified} order by id`;
    expect(audit.map((row) => row.action)).toEqual(['role.grant', 'role.revoke']);
  });

  it('is for admins only', async () => {
    const moderator = reviewer(await memberWithLogin('mod-c', uniTl, true), [{ role: 'uni_moderator', universityId: uniTl }]);
    await expect(changeModerator(moderator, { login: 'mod-c', universityId: uniTl, grant: true })).rejects.toMatchObject({ code: 'roles.forbidden' });
  });
});
