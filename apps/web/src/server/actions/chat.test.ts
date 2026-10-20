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

const member = { id: 'member-1', verified: true };
const requireVerified = vi.fn<() => Promise<typeof member>>();
vi.mock('@/server/guards', () => ({ requireVerified }));
const guardWriteRate = vi.fn<(userId: string) => Promise<void>>();
vi.mock('@/server/rate', () => ({ guardWriteRate }));
const core = {
  respondToRequest: vi.fn<(...args: unknown[]) => Promise<{ threadId: string | null }>>(),
  sendMessage: vi.fn<(...args: unknown[]) => Promise<{ id: string; createdAt: Date; threadId: string }>>(),
  editMessage: vi.fn<(...args: unknown[]) => Promise<{ threadId: string }>>(),
  deleteMessage: vi.fn<(...args: unknown[]) => Promise<void>>(),
  markRead: vi.fn<(...args: unknown[]) => Promise<void>>(),
  muteThread: vi.fn<(...args: unknown[]) => Promise<void>>(),
  leaveThread: vi.fn<(...args: unknown[]) => Promise<void>>(),
};
vi.mock('@commitmates/core', () => ({ ...core, AppError, ValidationError: class extends AppError {}, getLogger: () => ({ error: vi.fn() }) }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
const redirect = vi.fn((url: string) => {
  throw new RedirectSignal(url);
});
// Redirects pass through the action wrapper, as Next's control flow does.
vi.mock('next/navigation', () => ({
  redirect,
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

const actions = await import('./chat');

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

describe('chat actions', () => {
  it('accepting a request opens the conversation; declining stays on the inbox', async () => {
    core.respondToRequest.mockResolvedValueOnce({ threadId: 'thread-1' });
    await expect(actions.respondToRequestAction(null, form({ requestId: 'r-1', intent: 'accept' }))).rejects.toThrow('/inbox/thread-1');
    expect(core.respondToRequest).toHaveBeenCalledWith(member, { requestId: 'r-1', accept: true });

    core.respondToRequest.mockResolvedValueOnce({ threadId: null });
    expect(await actions.respondToRequestAction(null, form({ requestId: 'r-2', intent: 'decline' }))).toEqual({ ok: true, data: null });
    expect(core.respondToRequest).toHaveBeenLastCalledWith(member, { requestId: 'r-2', accept: false });
    expect(revalidatePath).toHaveBeenCalledWith('/inbox');
  });

  it('sends, edits and deletes messages for the signed-in member, rate-limited', async () => {
    core.sendMessage.mockResolvedValueOnce({ id: 'm-1', createdAt: new Date('2026-10-21T10:00:00Z'), threadId: 't-1' });
    expect(await actions.sendMessageAction(null, form({ threadId: 't-1', body: 'hi' }))).toEqual({ ok: true, data: { id: 'm-1', createdAt: '2026-10-21T10:00:00.000Z' } });
    expect(core.sendMessage).toHaveBeenCalledWith(member, { threadId: 't-1', body: 'hi' });

    core.editMessage.mockResolvedValueOnce({ threadId: 't-1' });
    expect(await actions.editMessageAction(null, form({ messageId: 'm-1', body: 'hello' }))).toEqual({ ok: true, data: null });
    expect(revalidatePath).toHaveBeenCalledWith('/inbox/t-1');

    expect(await actions.deleteMessageAction(null, form({ messageId: 'm-1', threadId: 't-1' }))).toEqual({ ok: true, data: null });
    expect(core.deleteMessage).toHaveBeenCalledWith(member, { messageId: 'm-1' });
    expect(guardWriteRate).toHaveBeenCalledTimes(3);
  });

  it('returns the rules’ errors inline', async () => {
    core.sendMessage.mockRejectedValueOnce(new AppError('chat.unreachable', "You can't message this person right now."));
    expect(await actions.sendMessageAction(null, form({ threadId: 't-1', body: 'hi' }))).toEqual({
      ok: false,
      error: { code: 'chat.unreachable', message: "You can't message this person right now." },
    });
  });

  it('marks read, mutes and leaves', async () => {
    expect(await actions.markReadAction('t-1')).toEqual({ ok: true, data: null });
    expect(core.markRead).toHaveBeenCalledWith(member, { threadId: 't-1' });
    await actions.muteThreadAction(null, form({ threadId: 't-1', muted: 'true' }));
    expect(core.muteThread).toHaveBeenCalledWith(member, { threadId: 't-1', muted: true });
    await expect(actions.leaveThreadAction(null, form({ threadId: 't-1' }))).rejects.toThrow('/inbox');
    expect(core.leaveThread).toHaveBeenCalledWith(member, { threadId: 't-1' });
  });

  it('refuses members who are not verified', async () => {
    requireVerified.mockRejectedValue(new AppError('auth.verify', 'Verify your university first.'));
    expect(await actions.sendMessageAction(null, form({ threadId: 't-1', body: 'hi' }))).toMatchObject({ ok: false });
    expect(core.sendMessage).not.toHaveBeenCalled();
  });
});
