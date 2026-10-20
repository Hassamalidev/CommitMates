import { beforeEach, describe, expect, it, vi } from 'vitest';

class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(code);
  }
}
class ValidationError extends AppError {
  readonly field: string | undefined = 'message';
}
class UnverifiedError extends AppError {}

const member = { id: 'member-1', verified: true };
const requireVerified = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const answerSuggestion = vi.fn<(...args: unknown[]) => Promise<void>>();
const requestFromSuggestion = vi.fn<(...args: unknown[]) => Promise<string>>();
const updateLearningGoals = vi.fn<(...args: unknown[]) => Promise<string[]>>();
vi.mock('@commitmates/core', () => ({
  answerSuggestion,
  requestFromSuggestion,
  updateLearningGoals,
  AppError,
  ValidationError,
  getLogger: () => ({ error: vi.fn() }),
}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const { answerSuggestionAction, requestFromSuggestionAction, saveLearningGoalsAction } = await import('./discover');

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

describe('discover actions', () => {
  it('records Like and Skip for the signed-in member, rate-limited, and refreshes the deck', async () => {
    expect(await answerSuggestionAction(null, form({ suggestionId: 's-1', intent: 'like', login: 'sam' }))).toEqual({
      ok: true,
      data: { action: 'liked', login: 'sam' },
    });
    expect(await answerSuggestionAction(null, form({ suggestionId: 's-2', intent: 'skip', login: 'kim' }))).toEqual({
      ok: true,
      data: { action: 'skipped', login: 'kim' },
    });
    expect(answerSuggestion).toHaveBeenNthCalledWith(1, member, 'liked', { suggestionId: 's-1' });
    expect(answerSuggestion).toHaveBeenNthCalledWith(2, member, 'skipped', { suggestionId: 's-2' });
    expect(guardWriteRate).toHaveBeenCalledWith('member-1');
    expect(revalidatePath).toHaveBeenCalledWith('/discover');
  });

  it('sends a request with the typed message and returns its error inline', async () => {
    requestFromSuggestion.mockResolvedValueOnce('request-1');
    expect(await requestFromSuggestionAction(null, form({ suggestionId: 's-1', message: 'Hello there' }))).toEqual({ ok: true, data: null });
    expect(requestFromSuggestion).toHaveBeenCalledWith(member, { suggestionId: 's-1', message: 'Hello there' });

    requestFromSuggestion.mockRejectedValueOnce(new ValidationError('chat.first_message_short', 'Say a little more.'));
    expect(await requestFromSuggestionAction(null, form({ suggestionId: 's-1', message: 'hi' }))).toEqual({
      ok: false,
      error: { code: 'chat.first_message_short', message: 'Say a little more.', field: 'message' },
    });
  });

  it('saves learning goals', async () => {
    updateLearningGoals.mockResolvedValue(['docker']);
    expect(await saveLearningGoalsAction(null, form({ learningGoals: 'docker' }))).toEqual({ ok: true, data: null });
    expect(updateLearningGoals).toHaveBeenCalledWith(member, { learningGoals: 'docker' });
  });

  it('refuses members who are not verified before touching anything', async () => {
    requireVerified.mockRejectedValue(new UnverifiedError('auth.verify', 'Verify your university first.'));
    const result = await answerSuggestionAction(null, form({ suggestionId: 's-1', intent: 'like' }));
    expect(result).toMatchObject({ ok: false, error: { code: 'auth.verify' } });
    expect(answerSuggestion).not.toHaveBeenCalled();
    expect(guardWriteRate).not.toHaveBeenCalled();
  });
});
