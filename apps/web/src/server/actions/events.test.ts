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

const member = { id: 'member-1', verified: true, universityId: 'uni-1', timezone: 'UTC' };
const requireVerified = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const core = {
  createEvent: vi.fn<(...args: unknown[]) => Promise<string>>(),
  joinEvent: vi.fn<(...args: unknown[]) => Promise<void>>(),
  leaveEvent: vi.fn<(...args: unknown[]) => Promise<void>>(),
  createGroup: vi.fn<(...args: unknown[]) => Promise<string>>(),
  joinGroup: vi.fn<(...args: unknown[]) => Promise<void>>(),
  leaveGroup: vi.fn<(...args: unknown[]) => Promise<void>>(),
  requestFormation: vi.fn<(...args: unknown[]) => Promise<number>>(),
  finalizeSquads: vi.fn<(...args: unknown[]) => Promise<void>>(),
  requestSquadSwap: vi.fn<(...args: unknown[]) => Promise<string>>(),
  decideSquadSwap: vi.fn<(...args: unknown[]) => Promise<void>>(),
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

const actions = await import('./events');

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

describe('event actions', () => {
  it('creates an event and opens it, leaving the team size to the default when empty', async () => {
    core.createEvent.mockResolvedValueOnce('event-1');
    const input = { title: 'Hack Night', description: '', visibility: 'university', startsOn: '2026-11-07', endsOn: '2026-11-08', teamSize: '' };
    await expect(actions.createEventAction(null, form(input))).rejects.toThrow('/events/event-1');
    expect(core.createEvent).toHaveBeenCalledWith(member, { title: 'Hack Night', description: '', visibility: 'university', startsOn: '2026-11-07', endsOn: '2026-11-08' });
    core.createEvent.mockResolvedValueOnce('event-2');
    await expect(actions.createEventAction(null, form({ ...input, teamSize: '3' }))).rejects.toThrow('/events/event-2');
    expect(core.createEvent).toHaveBeenLastCalledWith(member, expect.objectContaining({ teamSize: '3' }));
  });

  it('reads one free time per weekday and skips days left on not free', async () => {
    expect(await actions.joinEventAction(null, form({ eventId: 'e-1', 'from-1': '9', 'to-1': '17', 'from-3': '', 'to-3': '20', 'from-6': '10', 'to-6': '14' }))).toEqual({ ok: true, data: null });
    expect(core.joinEvent).toHaveBeenCalledWith(member, {
      eventId: 'e-1',
      availability: [
        { weekday: 1, from: 9, to: 17 },
        { weekday: 6, from: 10, to: 14 },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith('/events/e-1');
  });

  it('passes group, formation and swap decisions through, rate-limited, with errors inline', async () => {
    await actions.joinGroupAction(null, form({ eventId: 'e-1', code: 'ab12cd34' }));
    expect(core.joinGroup).toHaveBeenCalledWith(member, { eventId: 'e-1', code: 'ab12cd34' });
    await actions.decideSquadSwapAction(null, form({ eventId: 'e-1', requestId: 'r-1', accept: 'true' }));
    expect(core.decideSquadSwap).toHaveBeenCalledWith(member, { requestId: 'r-1', accept: true });
    await actions.decideSquadSwapAction(null, form({ eventId: 'e-1', requestId: 'r-2', accept: 'false' }));
    expect(core.decideSquadSwap).toHaveBeenLastCalledWith(member, { requestId: 'r-2', accept: false });
    expect(guardWriteRate).toHaveBeenCalledTimes(3);
    core.requestFormation.mockRejectedValueOnce(new AppError('squads.locked', 'Teams can be formed once 6 people have joined (2 so far).'));
    expect(await actions.formSquadsAction(null, form({ eventId: 'e-1' }))).toMatchObject({ ok: false, error: { code: 'squads.locked' } });
  });
});
