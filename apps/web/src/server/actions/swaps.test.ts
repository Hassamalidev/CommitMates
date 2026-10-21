import { beforeEach, describe, expect, it, vi } from 'vitest';

class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(code);
  }
}

const member = { id: 'member-1', verified: true, universityId: 'uni-1' };
const requireVerified = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const core = {
  setOffers: vi.fn<(...args: unknown[]) => Promise<string[]>>(),
  setWants: vi.fn<(...args: unknown[]) => Promise<void>>(),
  respondToProposal: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
};
vi.mock('@commitmates/core', () => ({ ...core, AppError, ValidationError: class extends AppError {}, getLogger: () => ({ error: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const { respondToProposalAction, setOffersAction, setWantsAction } = await import('./swaps');

beforeEach(() => {
  vi.clearAllMocks();
  requireVerified.mockResolvedValue(member);
  guardWriteRate.mockResolvedValue();
});

describe('skill swap actions', () => {
  it('splits offers, pairs each wanted skill with its priority and drops empty rows', async () => {
    const offers = new FormData();
    offers.set('selfDeclared', 'flutter, rust');
    expect(await setOffersAction(null, offers)).toEqual({ ok: true, data: null });
    expect(core.setOffers).toHaveBeenCalledWith(member, { selfDeclared: ['flutter', ' rust'] });

    const wants = new FormData();
    for (const [tag, priority] of [
      ['go', '3'],
      ['', '2'],
      ['sql', '1'],
    ]) {
      wants.append('tag', tag ?? '');
      wants.append('priority', priority ?? '');
    }
    await setWantsAction(null, wants);
    expect(core.setWants).toHaveBeenCalledWith(member, {
      wants: [
        { tag: 'go', priority: '3' },
        { tag: 'sql', priority: '1' },
      ],
    });
  });

  it('answers proposals, rate-limited, and shows service errors inline', async () => {
    const form = new FormData();
    form.set('proposalId', 'p1');
    form.set('response', 'accept');
    await respondToProposalAction(null, form);
    expect(core.respondToProposal).toHaveBeenCalledWith(member, { proposalId: 'p1', response: 'accept' });
    expect(guardWriteRate).toHaveBeenCalledWith(member.id);
    core.respondToProposal.mockRejectedValueOnce(new AppError('swap.closed', 'That proposal is no longer open.'));
    expect(await respondToProposalAction(null, form)).toMatchObject({ ok: false, error: { code: 'swap.closed' } });
  });
});
