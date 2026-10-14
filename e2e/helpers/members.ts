import { randomBytes } from 'node:crypto';

import { withAppDatabase } from './db';
import type { TestMember } from './session';

const DAY_MS = 24 * 60 * 60 * 1000;

export type MemberState = {
  universityId?: string | null;
  /** Days since verification; `null` leaves the member unverified. */
  verifiedDaysAgo?: number | null;
  onboarded?: boolean;
};

/**
 * Creates the member rows a real sign-in would (profile, GitHub identity with the session's login)
 * and puts the member in the given verification and onboarding state.
 */
export async function prepareMember(member: TestMember, state: MemberState = {}): Promise<void> {
  const days = state.verifiedDaysAgo ?? null;
  const verifiedAt = days === null ? null : new Date(Date.now() - days * DAY_MS);
  await withAppDatabase(async (sql) => {
    await sql`insert into users (id) values (${member.userId}) on conflict (id) do nothing`;
    await sql`insert into profiles (user_id, timezone) values (${member.userId}, 'UTC') on conflict (user_id) do nothing`;
    await sql`update profiles
              set university_id = ${state.universityId ?? null}, verified_at = ${verifiedAt},
                  verified_via = ${verifiedAt ? 'email' : null}, onboarded_at = ${state.onboarded ? new Date() : null}
              where user_id = ${member.userId}`;
    await sql`insert into github_identities (user_id, github_id, login)
              values (${member.userId}, ${Number.parseInt(randomBytes(3).toString('hex'), 16) + 800_000_000}, ${member.login})
              on conflict (user_id) do nothing`;
  });
}

/** A university for one test, in a country the pickers know. */
export async function seedUniversity(name: string, slug: string): Promise<string> {
  const [row] = await withAppDatabase(
    (sql) => sql<{ id: string }[]>`
      insert into universities (name, slug, country, country_code, web_pages, source, checksum)
      values (${name}, ${slug}, 'Testland', 'TL', '{}', 'admin', 'e2e') returning id`,
  );
  if (!row) throw new Error('university insert returned no row');
  return row.id;
}
