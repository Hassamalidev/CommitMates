/** Holds `<uni-slug>.<code>` from an invite link until the invitee finishes onboarding (CLAUDE.md §1.4). */
export const INVITE_COOKIE = 'cm_invite';

const SLUG = /^[a-z0-9-]{1,120}$/;
const CODE = /^[A-Za-z0-9_-]{12}$/;

/** The cookie value for an invite link's `ref` and `invite` parameters, or `null` when they are malformed. */
export function inviteCookieValue(ref: string | null, invite: string | null): string | null {
  return ref !== null && invite !== null && SLUG.test(ref) && CODE.test(invite) ? `${ref}.${invite}` : null;
}

/** The invite stored in the cookie, if it is well formed. */
export function parseInviteCookie(value: string | undefined): { slug: string; code: string } | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  const slug = value.slice(0, dot);
  const code = value.slice(dot + 1);
  return dot > 0 && SLUG.test(slug) && CODE.test(code) ? { slug, code } : null;
}
