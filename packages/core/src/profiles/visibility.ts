import { getDb, schema, type DbOrTx } from '@commitmates/db';
import { eq } from 'drizzle-orm';

const { githubIdentities, profiles, users } = schema;

export type ProfileVisibility = (typeof schema.profiles.$inferSelect)['visibility'];

export type ProfileOwner = {
  userId: string;
  login: string;
  githubId: number;
  visibility: ProfileVisibility;
  universityId: string | null;
  /** Hidden and suspended accounts have no page for anyone but themselves. */
  active: boolean;
};

export type ProfileViewer = { id: string; universityId: string | null; verified: boolean };

/** The member who owns `/u/<login>`, or `null` when nobody with that login has signed up. */
export async function getProfileOwner(login: string, db: DbOrTx = getDb()): Promise<ProfileOwner | null> {
  const [row] = await db
    .select({
      userId: githubIdentities.userId,
      login: githubIdentities.login,
      githubId: githubIdentities.githubId,
      visibility: profiles.visibility,
      universityId: profiles.universityId,
      status: users.status,
    })
    .from(githubIdentities)
    .innerJoin(profiles, eq(profiles.userId, githubIdentities.userId))
    .innerJoin(users, eq(users.id, githubIdentities.userId))
    .where(eq(githubIdentities.login, login));
  if (!row) return null;
  const { status, ...owner } = row;
  return { ...owner, active: status === 'active' };
}

/**
 * Who may see a member's profile page (CLAUDE.md §2.6, §8 F1 "Privacy"):
 *   - the member themselves, always;
 *   - `public`: anyone;
 *   - `university`: verified members of the same university;
 *   - `country`: verified members of a university in the same country;
 *   - `hidden`: nobody else.
 * `sameCountry` is decided by the caller, which knows the universities' countries. Until
 * the university list exists (Phase 3) only the same university counts as the same country.
 */
export function canViewProfile(owner: ProfileOwner, viewer: ProfileViewer | null, sameCountry?: boolean): boolean {
  if (viewer?.id === owner.userId) return true;
  if (!owner.active) return false;
  if (owner.visibility === 'public') return true;
  if (owner.visibility === 'hidden' || !viewer?.verified) return false;

  const sameUniversity = owner.universityId !== null && owner.universityId === viewer.universityId;
  if (owner.visibility === 'university') return sameUniversity;
  return sameCountry ?? sameUniversity;
}

/** Only a public profile of an active member may be indexed or shared. */
export const isPublicProfile = (owner: ProfileOwner): boolean => owner.active && owner.visibility === 'public';
