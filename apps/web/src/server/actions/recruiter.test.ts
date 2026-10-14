import { beforeEach, describe, expect, it, vi } from 'vitest';

class UnauthenticatedError extends Error {
  readonly code = 'auth.required';
  readonly userMessage = 'Please sign in to continue.';
  readonly status = 401;
}
class AppError extends Error {}

const requireUser = vi.fn<() => Promise<{ id: string }>>();
vi.mock('@/server/guards', () => ({ requireUser }));
const getOwnSecretScan = vi.fn<(userId: string) => Promise<unknown>>();
vi.mock('@commitmates/core', () => ({
  getOwnSecretScan,
  AppError,
  ValidationError: class extends AppError {},
  getLogger: () => ({ error: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const { loadOwnSecretScan } = await import('./recruiter');

beforeEach(() => {
  requireUser.mockReset();
  getOwnSecretScan.mockReset();
});

describe('loadOwnSecretScan', () => {
  it("reads the signed-in member's own scan and nobody else's", async () => {
    requireUser.mockResolvedValue({ id: 'member-1' });
    getOwnSecretScan.mockResolvedValue({
      findings: [{ ruleId: 'github-pat', repo: 'me/app', path: 'a.ts', line: 1 }],
      partial: false,
      filesScanned: 3,
      computedAt: new Date('2026-10-14T12:00:00.000Z'),
    });
    expect(await loadOwnSecretScan()).toEqual({
      ok: true,
      data: { findings: [{ ruleId: 'github-pat', repo: 'me/app', path: 'a.ts', line: 1 }], partial: false, filesScanned: 3, computedAt: '2026-10-14T12:00:00.000Z' },
    });
    expect(getOwnSecretScan).toHaveBeenCalledWith('member-1');
  });

  it('returns nothing when there is no scan yet', async () => {
    requireUser.mockResolvedValue({ id: 'member-1' });
    getOwnSecretScan.mockResolvedValue(null);
    expect(await loadOwnSecretScan()).toEqual({ ok: true, data: null });
  });

  it('refuses visitors', async () => {
    requireUser.mockRejectedValue(new UnauthenticatedError());
    const result = await loadOwnSecretScan();
    expect(result.ok).toBe(false);
    expect(getOwnSecretScan).not.toHaveBeenCalled();
  });
});
