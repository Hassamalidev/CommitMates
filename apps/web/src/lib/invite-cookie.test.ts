import { describe, expect, it } from 'vitest';

import { inviteCookieValue, parseInviteCookie } from './invite-cookie';

describe('invite cookie', () => {
  it('stores and reads a well-formed invite', () => {
    const value = inviteCookieValue('uni-of-testland-tl', 'AbC123_-xyz0');
    expect(value).toBe('uni-of-testland-tl.AbC123_-xyz0');
    expect(parseInviteCookie(value ?? undefined)).toEqual({ slug: 'uni-of-testland-tl', code: 'AbC123_-xyz0' });
  });

  it('ignores anything malformed', () => {
    expect(inviteCookieValue(null, 'AbC123_-xyz0')).toBeNull();
    expect(inviteCookieValue('Uni', 'AbC123_-xyz0')).toBeNull();
    expect(inviteCookieValue('uni-tl', 'short')).toBeNull();
    expect(inviteCookieValue('uni-tl', 'AbC123_-xyz0<')).toBeNull();
    for (const bad of [undefined, '', 'nodot', '.AbC123_-xyz0', 'uni-tl.short', 'UNI.AbC123_-xyz0']) expect(parseInviteCookie(bad), bad).toBeNull();
  });
});
