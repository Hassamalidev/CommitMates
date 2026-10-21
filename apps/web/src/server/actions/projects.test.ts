import { beforeEach, describe, expect, it, vi } from 'vitest';

class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(code);
  }
}

const member = { id: 'member-1', verified: true, githubId: 1 };
const requireVerified = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const core = {
  listRepo: vi.fn<(...args: unknown[]) => Promise<string>>(),
  withdrawRepo: vi.fn<(...args: unknown[]) => Promise<void>>(),
  dismissSuggestion: vi.fn<(...args: unknown[]) => Promise<void>>(),
  relistRepo: vi.fn<(...args: unknown[]) => Promise<void>>(),
  addLegacyEntry: vi.fn<(...args: unknown[]) => Promise<string>>(),
  removeLegacyEntry: vi.fn<(...args: unknown[]) => Promise<void>>(),
};
vi.mock('@commitmates/core', () => ({ ...core, AppError, ValidationError: class extends AppError {}, getLogger: () => ({ error: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const { addLegacyEntryAction, dismissSuggestionAction, listRepoAction, relistAction, removeLegacyEntryAction, withdrawListingAction } = await import('./projects');

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

describe('project actions', () => {
  it('lists, withdraws and dismisses for the signed-in member, rate-limited', async () => {
    core.listRepo.mockResolvedValueOnce('listing-1');
    expect(await listRepoAction(null, form({ repoGithubId: '42', note: 'needs tests' }))).toEqual({ ok: true, data: null });
    expect(core.listRepo).toHaveBeenCalledWith(member, { repoGithubId: '42', note: 'needs tests' });
    await withdrawListingAction(null, form({ listingId: 'listing-1' }));
    expect(core.withdrawRepo).toHaveBeenCalledWith(member, { listingId: 'listing-1' });
    await dismissSuggestionAction(null, form({ repoGithubId: '43' }));
    expect(core.dismissSuggestion).toHaveBeenCalledWith(member, { repoGithubId: '43' });
    await relistAction(null, form({ listingId: 'listing-1' }));
    expect(core.relistRepo).toHaveBeenCalledWith(member, { listingId: 'listing-1' });
    expect(guardWriteRate).toHaveBeenCalledTimes(4);
  });

  it('returns errors inline and refuses members who are not verified', async () => {
    core.listRepo.mockRejectedValueOnce(new AppError('listings.not_yours', 'You can only list your own repositories.'));
    expect(await listRepoAction(null, form({ repoGithubId: '9' }))).toMatchObject({ ok: false, error: { code: 'listings.not_yours' } });
    requireVerified.mockRejectedValue(new AppError('auth.unverified', 'Verify first.'));
    expect(await listRepoAction(null, form({ repoGithubId: '9' }))).toMatchObject({ ok: false });
    expect(core.listRepo).toHaveBeenCalledTimes(1);
  });

  it('showcases and removes entries, reading the questions checkbox', async () => {
    const form = (values: Record<string, string>) => {
      const data = new FormData();
      for (const [key, value] of Object.entries(values)) data.set(key, value);
      return data;
    };
    await addLegacyEntryAction(null, form({ repoGithubId: '7', blurb: 'Maps', acceptsQuestions: 'on' }));
    expect(core.addLegacyEntry).toHaveBeenCalledWith(member, { repoGithubId: '7', blurb: 'Maps', acceptsQuestions: true });
    await addLegacyEntryAction(null, form({ repoGithubId: '8', blurb: '' }));
    expect(core.addLegacyEntry).toHaveBeenLastCalledWith(member, { repoGithubId: '8', blurb: '', acceptsQuestions: false });
    await removeLegacyEntryAction(null, form({ entryId: 'e1' }));
    expect(core.removeLegacyEntry).toHaveBeenCalledWith(member, { entryId: 'e1' });
  });
});
