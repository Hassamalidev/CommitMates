import { beforeEach, describe, expect, it, vi } from 'vitest';

class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(code);
  }
}

const member = { id: 'member-1', verified: true };
const requireVerified = vi.fn<() => Promise<typeof member>>();
const requireUser = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified, requireUser }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const core = {
  blockMember: vi.fn<(...args: unknown[]) => Promise<void>>(),
  unblockMember: vi.fn<(...args: unknown[]) => Promise<void>>(),
  reportMember: vi.fn<(...args: unknown[]) => Promise<void>>(),
  submitFeedback: vi.fn<(...args: unknown[]) => Promise<void>>(),
};
vi.mock('@commitmates/core', () => ({ ...core, AppError, ValidationError: class extends AppError {}, getLogger: () => ({ error: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const { blockAction, feedbackAction, reportAction } = await import('./safety');

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireVerified.mockResolvedValue(member);
  requireUser.mockResolvedValue(member);
  guardWriteRate.mockResolvedValue();
});

describe('safety actions', () => {
  it('blocks and unblocks for the signed-in member', async () => {
    expect(await blockAction(null, form({ userId: 'u-2', intent: 'block' }))).toEqual({ ok: true, data: null });
    expect(core.blockMember).toHaveBeenCalledWith(member, { userId: 'u-2' });
    await blockAction(null, form({ userId: 'u-2', intent: 'unblock' }));
    expect(core.unblockMember).toHaveBeenCalledWith(member, { userId: 'u-2' });
  });

  it('reports with or without a message', async () => {
    await reportAction(null, form({ targetUserId: 'u-2', messageId: '', reason: 'spam', details: '' }));
    expect(core.reportMember).toHaveBeenCalledWith(member, { targetUserId: 'u-2', messageId: null, reason: 'spam', details: '' });
    await reportAction(null, form({ targetUserId: 'u-2', messageId: 'm-1', reason: 'other', details: 'x' }));
    expect(core.reportMember).toHaveBeenLastCalledWith(member, { targetUserId: 'u-2', messageId: 'm-1', reason: 'other', details: 'x' });
    expect(guardWriteRate).toHaveBeenCalledTimes(2);
  });

  it('accepts feedback from any signed-in member, verified or not', async () => {
    expect(await feedbackAction(null, form({ page: '/feedback', body: 'Nice work' }))).toEqual({ ok: true, data: null });
    expect(requireUser).toHaveBeenCalled();
    expect(requireVerified).not.toHaveBeenCalled();
  });

  it('refuses blocking and reporting before verification', async () => {
    requireVerified.mockRejectedValue(new AppError('auth.unverified', 'Verify your university first.'));
    expect(await reportAction(null, form({ targetUserId: 'u-2', reason: 'spam' }))).toMatchObject({ ok: false });
    expect(core.reportMember).not.toHaveBeenCalled();
  });
});
