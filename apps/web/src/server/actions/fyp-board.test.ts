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
const requireUser = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified, requireUser }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const core = {
  applySupervisor: vi.fn<(...args: unknown[]) => Promise<void>>(),
  checkIdea: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  confirmDetectedProject: vi.fn<(...args: unknown[]) => Promise<void>>(),
  decideSupervisor: vi.fn<(...args: unknown[]) => Promise<void>>(),
  dismissDetectedProject: vi.fn<(...args: unknown[]) => Promise<void>>(),
  expressInterest: vi.fn<(...args: unknown[]) => Promise<void>>(),
  pickTeam: vi.fn<(...args: unknown[]) => Promise<string>>(),
  postIdea: vi.fn<(...args: unknown[]) => Promise<string>>(),
  removePastProject: vi.fn<(...args: unknown[]) => Promise<void>>(),
  setIdeaStatus: vi.fn<(...args: unknown[]) => Promise<void>>(),
  submitPastProject: vi.fn<(...args: unknown[]) => Promise<string>>(),
  withdrawInterest: vi.fn<(...args: unknown[]) => Promise<void>>(),
};
vi.mock('@commitmates/core', () => ({ ...core, AppError, ValidationError: class extends AppError {}, getLogger: () => ({ error: vi.fn() }) }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

const actions = await import('./fyp-board');

const form = (values: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) for (const item of [value].flat()) data.append(key, item);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireVerified.mockResolvedValue(member);
  requireUser.mockResolvedValue(member);
  guardWriteRate.mockResolvedValue();
});

describe('FYP Board actions', () => {
  it('checks and posts ideas, opening the posted idea', async () => {
    core.checkIdea.mockResolvedValueOnce({ keyphrases: ['smart attendance'], university: null });
    expect(await actions.checkIdeaAction({ title: 'T', description: 'D' })).toEqual({ ok: true, data: { keyphrases: ['smart attendance'], university: null } });
    core.postIdea.mockResolvedValueOnce('idea-1');
    await expect(actions.postIdeaAction({ title: 'T', description: 'D', supervisorIdea: false })).rejects.toThrow('/fyp/ideas/idea-1');
    expect(core.postIdea).toHaveBeenCalledWith(member, { title: 'T', description: 'D', supervisorIdea: false });
  });

  it('splits supervisor areas, picks a team into its conversation, and refreshes the idea', async () => {
    await actions.applySupervisorAction(null, form({ areas: ' machine-learning, ,computer-vision ' }));
    expect(core.applySupervisor).toHaveBeenCalledWith(member, { areas: ['machine-learning', 'computer-vision'] });
    core.pickTeam.mockResolvedValueOnce('thread-1');
    await expect(actions.pickTeamAction(null, form({ ideaId: 'idea-1', userId: ['u-1', 'u-2'] }))).rejects.toThrow('/inbox/thread-1');
    expect(core.pickTeam).toHaveBeenCalledWith(member, { ideaId: 'idea-1', userIds: ['u-1', 'u-2'] });
    await actions.expressInterestAction(null, form({ ideaId: 'idea-1', message: 'Hi' }));
    expect(revalidatePath).toHaveBeenCalledWith('/fyp/ideas/idea-1');
    expect(guardWriteRate).toHaveBeenCalledTimes(3);
  });

  it('decides supervisor applications as the signed-in member, with errors inline', async () => {
    await actions.decideSupervisorAction(null, form({ userId: 'u-9', universityId: 'uni-1', approve: 'true' }));
    expect(core.decideSupervisor).toHaveBeenCalledWith(member, { userId: 'u-9', universityId: 'uni-1', approve: true });
    core.decideSupervisor.mockRejectedValueOnce(new AppError('fyp.not_your_university', 'You can only review supervisors of universities you moderate.'));
    expect(await actions.decideSupervisorAction(null, form({ userId: 'u-9', universityId: 'uni-2', approve: 'false' }))).toMatchObject({ ok: false, error: { code: 'fyp.not_your_university' } });
  });
});
