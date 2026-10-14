import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getOnboardingOptions, resolveDepartment, saveOnboardingDetails } from './onboarding';

const NOW = new Date('2026-10-14T12:00:00Z');
let database: TestDatabase;
let uni: string;

const base = {
  role: 'student',
  gradYear: '2027',
  department: '',
  learningGoals: '',
  visibility: 'university',
  shareTodayStatus: 'on',
  emailDigest: '',
  timezone: 'Asia/Karachi',
};

async function verifiedMember(): Promise<{ id: string; verified: true; universityId: string }> {
  const id = await insertTestUser(database.sql);
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${uni}, now())`;
  return { id, verified: true, universityId: uni };
}

beforeAll(async () => {
  database = await useTestDatabase();
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni', 'uni-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  uni = row!.id;
  await database.sql`insert into topics (slug, display_name, aliases, related, blob_sha, synced_at)
                     values ('react', 'React', '{}', '{}', 'a', now()), ('machine-learning', 'Machine learning', '{}', '{}', 'b', now())`;
  await database.sql`insert into package_meta (ecosystem, name, keywords, classifiers, gh_topics, derived_tags, fetched_at, expires_at)
                     values ('npm', 'x', '{}', '{}', '{}', '{web-framework,react}', now(), now() + interval '1 day')`;
});
afterAll(async () => {
  await database.destroy();
});

describe('resolveDepartment', () => {
  it('reuses a department with a similar name and creates new ones otherwise', async () => {
    const author = await verifiedMember();
    const cs = await resolveDepartment(uni, 'Computer Science', author.id);
    expect(await resolveDepartment(uni, 'computer-science', author.id)).toEqual(cs);
    expect(await resolveDepartment(uni, 'Computer Sciences', author.id)).toEqual(cs);
    const physics = await resolveDepartment(uni, 'Physics', author.id);
    expect(physics.id).not.toBe(cs.id);
    await expect(resolveDepartment(uni, '!!!', author.id)).rejects.toMatchObject({ field: 'department' });
  });

  it('follows a merge to the department that remains', async () => {
    const author = await verifiedMember();
    const kept = await resolveDepartment(uni, 'Electrical Engineering', author.id);
    const [merged] = await database.sql<{ id: string }[]>`
      insert into departments (university_id, name, normalized_name, merged_into_id)
      values (${uni}, 'EE Dept of Electricity', 'ee dept of electricity', ${kept.id}) returning id`;
    expect(merged).toBeDefined();
    expect(await resolveDepartment(uni, 'EE Dept of Electricity', author.id)).toEqual(kept);
  });
});

describe('saveOnboardingDetails', () => {
  it('saves the details, marks the member onboarded once, and stores notification preferences', async () => {
    const member = await verifiedMember();
    await saveOnboardingDetails(member, { ...base, department: 'Mathematics', learningGoals: 'React, machine learning, react' }, NOW);
    const [profile] = await database.sql`
      select p.role, p.grad_year, p.learning_goals, p.visibility, p.share_today_status, p.timezone, p.onboarded_at, d.name as department, n.email_digest
      from profiles p left join departments d on d.id = p.department_id left join notification_prefs n on n.user_id = p.user_id
      where p.user_id = ${member.id}`;
    expect(profile).toMatchObject({
      role: 'student',
      grad_year: 2027,
      learning_goals: ['react', 'machine-learning'],
      visibility: 'university',
      share_today_status: true,
      timezone: 'Asia/Karachi',
      department: 'Mathematics',
      email_digest: false,
    });
    expect(profile?.onboarded_at).toEqual(NOW);

    await saveOnboardingDetails(member, { ...base, role: 'alumni' }, new Date('2026-12-01T00:00:00Z'));
    const [again] = await database.sql`select role, onboarded_at from profiles where user_id = ${member.id}`;
    expect(again).toMatchObject({ role: 'alumni', onboarded_at: NOW });
  });

  it('accepts only learning goals from the tag vocabulary, up to the limit', async () => {
    const member = await verifiedMember();
    await expect(saveOnboardingDetails(member, { ...base, learningGoals: 'react, quantum-basket-weaving' }, NOW)).rejects.toMatchObject({
      field: 'learningGoals',
      userMessage: expect.stringContaining('quantum-basket-weaving') as string,
    });
    await withSettings({ 'profile.maxLearningGoals': 1 }, async () => {
      await expect(saveOnboardingDetails(member, { ...base, learningGoals: 'react, web-framework' }, NOW)).rejects.toMatchObject({
        code: 'onboarding.too_many_goals',
      });
    });
    await expect(saveOnboardingDetails(member, { ...base, learningGoals: 'web-framework' }, NOW)).resolves.toBeUndefined();
  });

  it('checks the graduation year range, the timezone, and that the member is verified', async () => {
    const member = await verifiedMember();
    await expect(saveOnboardingDetails(member, { ...base, gradYear: '2040' }, NOW)).rejects.toMatchObject({ field: 'gradYear' });
    await expect(saveOnboardingDetails(member, { ...base, gradYear: '1900' }, NOW)).rejects.toMatchObject({ field: 'gradYear' });
    await expect(saveOnboardingDetails(member, { ...base, gradYear: '' }, NOW)).resolves.toBeUndefined();
    await expect(saveOnboardingDetails(member, { ...base, timezone: 'Mars/Olympus' }, NOW)).rejects.toMatchObject({ field: 'timezone' });
    await expect(saveOnboardingDetails({ ...member, verified: false }, base, NOW)).rejects.toMatchObject({ code: 'onboarding.verify_first' });
  });

  it('only accepts a picked department of the member’s own university', async () => {
    const member = await verifiedMember();
    const [foreign] = await database.sql<{ id: string }[]>`
      insert into universities (name, slug, country, country_code, web_pages, source, checksum)
      values ('Elsewhere', 'elsewhere-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
    const [dept] = await database.sql<{ id: string }[]>`
      insert into departments (university_id, name, normalized_name) values (${foreign!.id}, 'Geology', 'geology') returning id`;
    await saveOnboardingDetails(member, { ...base, department: dept!.id }, NOW);
    const [profile] = await database.sql`select d.university_id from profiles p join departments d on d.id = p.department_id where p.user_id = ${member.id}`;
    // The foreign id is treated as a typed name and becomes a department of the member's university.
    expect(profile?.university_id).toBe(uni);
  });
});

describe('getOnboardingOptions', () => {
  it('offers the university departments, vocabulary suggestions and the year range', async () => {
    const member = await verifiedMember();
    const options = await getOnboardingOptions(member, NOW);
    expect(options.departments.map((department) => department.name)).toContain('Computer Science');
    expect(options.suggestions[0]).toBe('react');
    expect(options.years).toEqual({ min: 1966, max: 2034 });
  });
});
