import { getDb, getUniversity, schema, type DbOrTx } from '@commitmates/db';
import { eq } from 'drizzle-orm';

const { githubIdentities, profiles, universities, users } = schema;

export type ProfileVisibility = (typeof schema.profiles.$inferSelect)['visibility'];

export type ProfileOwner = {
  userId: string;
  login: string;
  githubId: number;
  visibility: ProfileVisibility;
  universityId: string | null;
  /** The country of the owner's university, for `country` visibility. */
  countryCode: string | null;
  /** Hidden and suspended accounts have no page for anyone but themselves. */
  active: boolean;
};

export type ProfileViewer = { id: string; universityId: string | null; verified: boolean; countryCode: string | null };

/** A signed-in member as a profile viewer, with their university's country. */
export async function profileViewerFor(member: { id: string; universityId: string | null; verified: boolean }): Promise<ProfileViewer> {
  const university = member.universityId === null ? null : await getUniversity(member.universityId);
  return { id: member.id, universityId: member.universityId, verified: member.verified, countryCode: university?.countryCode ?? null };
}

/** The member who owns `/u/<login>`, or `null` when nobody with that login has signed up. */
export async function getProfileOwner(login: string, db: DbOrTx = getDb()): Promise<ProfileOwner | null> {
  const [row] = await db
    .select({
      userId: githubIdentities.userId,
      login: githubIdentities.login,
      githubId: githubIdentities.githubId,
      visibility: profiles.visibility,
      universityId: profiles.universityId,
      countryCode: universities.countryCode,
      status: users.status,
    })
    .from(githubIdentities)
    .innerJoin(profiles, eq(profiles.userId, githubIdentities.userId))
    .leftJoin(universities, eq(universities.id, profiles.universityId))
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
 *   - `country`: verified members of a university in the same country (the same university included);
 *   - `hidden`: nobody else.
 */
export function canViewProfile(owner: ProfileOwner, viewer: ProfileViewer | null): boolean {
  if (viewer?.id === owner.userId) return true;
  if (!owner.active) return false;
  if (owner.visibility === 'public') return true;
  if (owner.visibility === 'hidden' || !viewer?.verified) return false;

  const sameUniversity = owner.universityId !== null && owner.universityId === viewer.universityId;
  if (owner.visibility === 'university') return sameUniversity;
  return sameUniversity || (owner.countryCode !== null && owner.countryCode === viewer.countryCode);
}

/** Only a public profile of an active member may be indexed or shared. */
export const isPublicProfile = (owner: ProfileOwner): boolean => owner.active && owner.visibility === 'public';
