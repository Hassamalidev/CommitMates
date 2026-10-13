import type { Member } from '@commitmates/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentMember = vi.fn<() => Promise<Member | null>>();
vi.mock('./auth', () => ({ getCurrentMember }));

const { UnauthenticatedError, requireRole, requireUser, requireVerified } = await import('./guards');

const UNI = '11111111-1111-4111-8111-111111111111';
const member = (overrides: Partial<Member> = {}): Member => ({
  id: 'user-1',
  status: 'active',
  githubId: 1,
  login: 'ada',
  name: null,
  avatarUrl: null,
  hasValidToken: true,
  universityId: null,
  verified: false,
  onboarded: false,
  timezone: 'UTC',
  roles: [],
  ...overrides,
});

describe('guards', () => {
  beforeEach(() => {
    getCurrentMember.mockReset();
  });

  it('requireUser rejects a missing session with 401', async () => {
    getCurrentMember.mockResolvedValue(null);
    const error = await requireUser().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(error).toMatchObject({ status: 401, code: 'auth.required' });
  });

  it('requireUser rejects a suspended member and accepts an active one', async () => {
    getCurrentMember.mockResolvedValue(member({ status: 'suspended' }));
    await expect(requireUser()).rejects.toMatchObject({ status: 403, code: 'auth.suspended' });
    getCurrentMember.mockResolvedValue(member());
    await expect(requireUser()).resolves.toMatchObject({ id: 'user-1' });
  });

  it('requireVerified needs a verified university', async () => {
    getCurrentMember.mockResolvedValue(member());
    await expect(requireVerified()).rejects.toMatchObject({ status: 403, code: 'auth.unverified' });
    getCurrentMember.mockResolvedValue(member({ verified: true, universityId: UNI }));
    await expect(requireVerified()).resolves.toMatchObject({ verified: true });
  });

  it('requireRole admits admins and scoped moderators only', async () => {
    getCurrentMember.mockResolvedValue(member());
    await expect(requireRole('admin')).rejects.toMatchObject({ status: 403, code: 'auth.forbidden' });

    getCurrentMember.mockResolvedValue(member({ roles: [{ role: 'admin', universityId: null }] }));
    await expect(requireRole('admin')).resolves.toBeDefined();

    getCurrentMember.mockResolvedValue(member({ roles: [{ role: 'uni_moderator', universityId: UNI }] }));
    await expect(requireRole({ role: 'uni_moderator', universityId: UNI })).resolves.toBeDefined();
    await expect(requireRole({ role: 'uni_moderator', universityId: 'other' })).rejects.toMatchObject({ status: 403 });
    await expect(requireRole('admin')).rejects.toMatchObject({ status: 403 });
  });
});
