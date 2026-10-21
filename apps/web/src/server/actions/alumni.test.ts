import { beforeEach, describe, expect, it, vi } from 'vitest';

class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(code);
  }
}
class RedirectSignal extends Error {}

const member = { id: 'member-1', verified: true, universityId: 'uni-1' };
const requireVerified = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const core = {
  askQuestion: vi.fn<(...args: unknown[]) => Promise<string>>(),
  answerQuestion: vi.fn<(...args: unknown[]) => Promise<string>>(),
  passQuestion: vi.fn<(...args: unknown[]) => Promise<void>>(),
  correctGraduation: vi.fn<(...args: unknown[]) => Promise<'student' | 'alumni'>>(),
};
vi.mock('@commitmates/core', () => ({ ...core, AppError, ValidationError: class extends AppError {}, getLogger: () => ({ error: vi.fn() }) }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
const redirect = vi.fn((url: string) => {
  throw new RedirectSignal(url);
});
vi.mock('next/navigation', () => ({
  redirect,
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

const actions = await import('./alumni');

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

describe('alumni actions', () => {
  it('asks with comma-separated topics and the anonymous box, rate-limited', async () => {
    core.askQuestion.mockResolvedValueOnce('q-1');
    expect(await actions.askQuestionAction(null, form({ body: 'How?', tags: ' react, ,docker ', anonymous: 'on' }))).toEqual({ ok: true, data: null });
    expect(core.askQuestion).toHaveBeenCalledWith(member, { body: 'How?', tags: ['react', 'docker'], anonymous: true });
    core.askQuestion.mockResolvedValueOnce('q-2');
    await actions.askQuestionAction(null, form({ body: 'Why?' }));
    expect(core.askQuestion).toHaveBeenLastCalledWith(member, { body: 'Why?', tags: [], anonymous: false });
    expect(guardWriteRate).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith('/alumni');
  });

  it('answering opens the conversation; passing and corrections stay on the page', async () => {
    core.answerQuestion.mockResolvedValueOnce('thread-9');
    await expect(actions.answerQuestionAction(null, form({ questionId: 'q-1' }))).rejects.toThrow('/inbox/thread-9');
    expect(core.answerQuestion).toHaveBeenCalledWith(member, { questionId: 'q-1' });

    expect(await actions.passQuestionAction(null, form({ questionId: 'q-1' }))).toEqual({ ok: true, data: null });
    expect(core.passQuestion).toHaveBeenCalledWith(member, { questionId: 'q-1' });

    core.correctGraduation.mockResolvedValueOnce('student');
    expect(await actions.correctGraduationAction(null, form({ gradYear: '2027' }))).toEqual({ ok: true, data: null });
    expect(core.correctGraduation).toHaveBeenCalledWith(member, { gradYear: '2027' });
  });

  it('shows service errors inline', async () => {
    core.passQuestion.mockRejectedValueOnce(new AppError('alumni.closed', 'That question is no longer waiting for an answer.'));
    expect(await actions.passQuestionAction(null, form({ questionId: 'q-1' }))).toMatchObject({ ok: false, error: { code: 'alumni.closed', message: 'That question is no longer waiting for an answer.' } });
  });
});
