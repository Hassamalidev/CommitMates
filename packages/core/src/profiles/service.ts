import { encrypt, getDb, getLogger, schema, type DbOrTx } from '@commitmates/db';
import { serverEnv } from '@commitmates/env/server';
import { eq, sql } from 'drizzle-orm';

import { signInSchema, type Member, type SignInInput } from './schemas';

const { auditLog, githubIdentities, profiles, roles, users } = schema;

/** Timezone used until onboarding captures the browser's (CLAUDE.md §6.10). */
const DEFAULT_TIMEZONE = 'UTC';

export type SignInResult = { isNewMember: boolean; grantedAdmin: boolean };

/**
 * Called by the auth callback after Supabase exchanges the OAuth code (CLAUDE.md §8 F10 step 1):
 * upserts the member, stores the GitHub token encrypted, creates the profile, and grants
 * `admin` to the bootstrap account on its first sign-in.
 */
export async function completeSignIn(input: SignInInput, now: Date = new Date()): Promise<SignInResult> {
  const data = signInSchema.parse(input);

  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({ id: data.userId, lastSeenAt: now })
      .onConflictDoUpdate({ target: users.id, set: { lastSeenAt: now } })
      .returning({ isNew: sql<boolean>`(xmax = 0)` });
    const isNewMember = inserted[0]?.isNew === true;

    const identity = {
      githubId: data.githubId,
      login: data.login,
      name: data.name,
      avatarUrl: data.avatarUrl,
      scopes: data.scopes,
    };
    // Without a fresh token the stored one is kept: a session refresh must not wipe it.
    const token =
      data.providerToken === null
        ? {}
        : {
            tokenEnc: encrypt(data.providerToken),
            tokenKeyVersion: serverEnv.TOKEN_ENCRYPTION_KEY_VERSION,
            tokenInvalid: false,
          };
    await tx
      .insert(githubIdentities)
      .values({ userId: data.userId, ...identity, ...token })
      .onConflictDoUpdate({ target: githubIdentities.userId, set: { ...identity, ...token } });

    await tx.insert(profiles).values({ userId: data.userId, timezone: DEFAULT_TIMEZONE }).onConflictDoNothing();

    let grantedAdmin = false;
    if (data.githubId === serverEnv.BOOTSTRAP_ADMIN_GITHUB_ID) {
      const granted = await tx
        .insert(roles)
        .values({ userId: data.userId, role: 'admin', grantedAt: now })
        .onConflictDoNothing()
        .returning({ id: roles.id });
      grantedAdmin = granted.length > 0;
      if (grantedAdmin) {
        await tx.insert(auditLog).values({
          actorUserId: null,
          action: 'role.bootstrap_admin',
          targetType: 'user',
          targetId: data.userId,
          data: { githubId: data.githubId },
        });
        getLogger().info({ githubId: data.githubId }, 'bootstrap admin granted');
      }
    }
    return { isNewMember, grantedAdmin };
  });
}

/**
 * Makes sure an authenticated Supabase user has its member rows, for the case where a
 * session exists but the callback never completed. Does not touch tokens.
 */
export async function ensureMemberRows(userId: string, db: DbOrTx = getDb()): Promise<void> {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(profiles).values({ userId, timezone: DEFAULT_TIMEZONE }).onConflictDoNothing();
}

/** The member with their GitHub identity, verification state and roles, or `null`. */
export async function getMember(userId: string, db: DbOrTx = getDb()): Promise<Member | null> {
  const [row] = await db
    .select({
      id: users.id,
      status: users.status,
      githubId: githubIdentities.githubId,
      login: githubIdentities.login,
      name: githubIdentities.name,
      avatarUrl: githubIdentities.avatarUrl,
      tokenEnc: githubIdentities.tokenEnc,
      tokenInvalid: githubIdentities.tokenInvalid,
      universityId: profiles.universityId,
      verifiedAt: profiles.verifiedAt,
      onboardedAt: profiles.onboardedAt,
      timezone: profiles.timezone,
    })
    .from(users)
    .leftJoin(githubIdentities, eq(githubIdentities.userId, users.id))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) return null;

  const memberRoles = await db
    .select({ role: roles.role, universityId: roles.universityId })
    .from(roles)
    .where(eq(roles.userId, userId));

  return {
    id: row.id,
    status: row.status,
    githubId: row.githubId,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatarUrl,
    hasValidToken: row.tokenEnc !== null && row.tokenInvalid === false,
    universityId: row.universityId,
    verified: row.verifiedAt !== null && row.universityId !== null,
    onboarded: row.onboardedAt !== null,
    timezone: row.timezone ?? DEFAULT_TIMEZONE,
    roles: memberRoles,
  };
}

export type RoleRequirement = 'admin' | { role: 'uni_moderator'; universityId: string };

/** Admins pass every check; a moderator passes only for their own university (CLAUDE.md §5.11). */
export function hasRole(member: Pick<Member, 'roles'>, requirement: RoleRequirement): boolean {
  if (member.roles.some((entry) => entry.role === 'admin')) return true;
  if (requirement === 'admin') return false;
  return member.roles.some(
    (entry) => entry.role === 'uni_moderator' && entry.universityId === requirement.universityId,
  );
}
