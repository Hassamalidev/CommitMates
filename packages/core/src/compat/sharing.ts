import { getProfileOwner, isPublicProfile } from '../profiles/visibility';

/**
 * Whether a comparison may get a share link and image (CLAUDE.md §8 F2 "Privacy"): both
 * people are members with public profiles, or the viewer is one of the two and the other
 * is a member with a public profile. Anyone else's comparison stays with the person who
 * asked for it.
 */
export async function compatShareAllowed(loginA: string, loginB: string, viewerLogin: string | null): Promise<boolean> {
  const [a, b] = await Promise.all([getProfileOwner(loginA), getProfileOwner(loginB)]);
  if (!a || !b) return false;
  if (isPublicProfile(a) && isPublicProfile(b)) return true;

  const viewer = viewerLogin?.toLowerCase();
  if (viewer === undefined) return false;
  if (viewer === a.login.toLowerCase()) return a.active && isPublicProfile(b);
  if (viewer === b.login.toLowerCase()) return b.active && isPublicProfile(a);
  return false;
}
