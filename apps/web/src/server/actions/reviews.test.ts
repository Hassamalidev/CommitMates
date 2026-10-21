import { beforeEach, describe, expect, it, vi } from 'vitest';

class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(code);
  }
}

const member = { id: 'member-1', verified: true, login: 'kim', roles: [] };
const requireVerified = vi.fn<() => Promise<typeof member>>();
const requireUser = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified, requireUser }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const core = {
  createReviewRequest: vi.fn<(...args: unknown[]) => Promise<string>>(),
  claimRequest: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  unclaimRequest: vi.fn<(...args: unknown[]) => Promise<void>>(),
  markSubmitted: vi.fn<(...args: unknown[]) => Promise<string>>(),
  rateReview: vi.fn<(...args: unknown[]) => Promise<void>>(),
  withdrawReviewRequest: vi.fn<(...args: unknown[]) => Promise<void>>(),
  disputeRating: vi.fn<(...args: unknown[]) => Promise<void>>(),
  resolveDispute: vi.fn<(...args: unknown[]) => Promise<void>>(),
  adjustCredits: vi.fn<(...args: unknown[]) => Promise<number>>(),
};
vi.mock('@commitmates/core', () => ({ ...core, AppError, ValidationError: class extends AppError {}, getLogger: () => ({ error: vi.fn() }) }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const actions = await import('./reviews');

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

describe('review exchange actions', () => {
  it('passes each member step to the service, rate-limited, and refreshes the page', async () => {
    expect(await actions.createReviewRequestAction(null, form({ prUrl: 'https://github.com/kim/app/pull/3' }))).toEqual({ ok: true, data: null });
    expect(core.createReviewRequest).toHaveBeenCalledWith(member, { prUrl: 'https://github.com/kim/app/pull/3' });
    await actions.claimRequestAction(null, form({ requestId: 'r1' }));
    await actions.unclaimRequestAction(null, form({ requestId: 'r1' }));
    await actions.markSubmittedAction(null, form({ requestId: 'r1' }));
    await actions.rateReviewAction(null, form({ requestId: 'r1', rating: 'helpful' }));
    await actions.withdrawReviewRequestAction(null, form({ requestId: 'r2' }));
    await actions.disputeRatingAction(null, form({ requestId: 'r3', note: 'It found a bug.' }));
    expect(core.claimRequest).toHaveBeenCalledWith(member, { requestId: 'r1' });
    expect(core.unclaimRequest).toHaveBeenCalledWith(member, { requestId: 'r1' });
    expect(core.markSubmitted).toHaveBeenCalledWith(member, { requestId: 'r1' });
    expect(core.rateReview).toHaveBeenCalledWith(member, { requestId: 'r1', rating: 'helpful' });
    expect(core.withdrawReviewRequest).toHaveBeenCalledWith(member, { requestId: 'r2' });
    expect(core.disputeRating).toHaveBeenCalledWith(member, { requestId: 'r3', note: 'It found a bug.' });
    expect(guardWriteRate).toHaveBeenCalledTimes(7);
    expect(revalidatePath).toHaveBeenCalledWith('/reviews');
  });

  it('hands moderator decisions to the service, which checks the role', async () => {
    await actions.resolveDisputeAction(null, form({ requestId: 'r3', outcome: 'reviewer', note: 'Fair' }));
    expect(core.resolveDispute).toHaveBeenCalledWith(member, { requestId: 'r3', outcome: 'reviewer', note: 'Fair' });
    core.adjustCredits.mockRejectedValueOnce(new AppError('reviews.adjust_forbidden', 'Only admins can adjust credits.'));
    expect(await actions.adjustCreditsAction(null, form({ login: 'kim', delta: '2', note: 'Dispute' }))).toMatchObject({
      ok: false,
      error: { code: 'reviews.adjust_forbidden' },
    });
  });

  it('shows service errors inline and refuses members who are not verified', async () => {
    core.createReviewRequest.mockRejectedValueOnce(new AppError('reviews.no_credit', "Review someone else's code to earn a credit."));
    expect(await actions.createReviewRequestAction(null, form({ prUrl: 'x' }))).toMatchObject({ ok: false, error: { code: 'reviews.no_credit' } });
    requireVerified.mockRejectedValue(new AppError('auth.unverified', 'Verify first.'));
    expect(await actions.claimRequestAction(null, form({ requestId: 'r1' }))).toMatchObject({ ok: false });
    expect(core.claimRequest).not.toHaveBeenCalled();
  });
});
