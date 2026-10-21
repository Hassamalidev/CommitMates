import { beforeEach, describe, expect, it, vi } from 'vitest';

class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(code);
  }
}

const member = { id: 'member-1', verified: true, login: 'adopter' };
const requireVerified = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const core = {
  requestAdoption: vi.fn<(...args: unknown[]) => Promise<string>>(),
  recordAdoptionInterest: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
  linkFork: vi.fn<(...args: unknown[]) => Promise<string>>(),
};
vi.mock('@commitmates/core', () => ({ ...core, AppError, ValidationError: class extends AppError {}, getLogger: () => ({ error: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const { linkForkAction, recordAdoptionInterestAction, requestAdoptionAction } = await import('./adoptions');

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireVerified.mockResolvedValue(member);
  guardWriteRate.mockResolvedValue();
});

describe('adoption actions', () => {
  it('requests an adoption, records interest and links a fork for the signed-in member, rate-limited', async () => {
    core.requestAdoption.mockResolvedValueOnce('adoption-1');
    expect(await requestAdoptionAction(null, form({ listingId: 'listing-1', message: 'I would like to finish it.' }))).toEqual({ ok: true, data: null });
    expect(core.requestAdoption).toHaveBeenCalledWith(member, { listingId: 'listing-1', message: 'I would like to finish it.' });
    core.recordAdoptionInterest.mockResolvedValueOnce(true);
    expect(await recordAdoptionInterestAction(42)).toEqual({ ok: true, data: { recorded: true } });
    expect(core.recordAdoptionInterest).toHaveBeenCalledWith(member, { repoGithubId: 42 });
    core.linkFork.mockResolvedValueOnce('adopter/app');
    await linkForkAction(null, form({ adoptionId: 'adoption-1', fork: 'adopter/app' }));
    expect(core.linkFork).toHaveBeenCalledWith(member, { adoptionId: 'adoption-1', fork: 'adopter/app' });
    expect(guardWriteRate).toHaveBeenCalledTimes(3);
  });

  it('returns errors inline and refuses members who are not verified', async () => {
    core.linkFork.mockRejectedValueOnce(new AppError('adoptions.fork_not_yours', 'Link the fork in your own GitHub account.'));
    expect(await linkForkAction(null, form({ adoptionId: 'a', fork: 'x/y' }))).toMatchObject({ ok: false, error: { code: 'adoptions.fork_not_yours' } });
    requireVerified.mockRejectedValue(new AppError('auth.unverified', 'Verify first.'));
    expect(await recordAdoptionInterestAction(1)).toMatchObject({ ok: false });
    expect(core.recordAdoptionInterest).not.toHaveBeenCalled();
  });
});
