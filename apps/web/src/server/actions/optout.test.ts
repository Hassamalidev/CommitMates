import { beforeEach, describe, expect, it, vi } from 'vitest';

class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(code);
  }
}

const guardToolRate = vi.fn<(tool: string, headers: Headers) => Promise<string>>();
vi.mock('@/server/rate', () => ({ guardToolRate }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '203.0.113.9' })) }));
const optOutOfCountryIndex = vi.fn<(raw: unknown) => Promise<string>>();
vi.mock('@commitmates/core', () => ({ optOutOfCountryIndex, AppError, ValidationError: class extends AppError {}, getLogger: () => ({ error: vi.fn() }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const { optOutAction } = await import('./optout');

const form = (login: string) => {
  const data = new FormData();
  data.set('login', login);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  guardToolRate.mockResolvedValue('hash');
  optOutOfCountryIndex.mockResolvedValue('someone');
});

describe('optOutAction', () => {
  it('rate-limits by address and passes the login on', async () => {
    expect(await optOutAction(null, form('someone'))).toEqual({ ok: true, data: null });
    expect(guardToolRate).toHaveBeenCalledWith('optout', expect.any(Headers));
    expect(optOutOfCountryIndex).toHaveBeenCalledWith({ login: 'someone' });
  });

  it('stops at the rate limit before touching anything', async () => {
    guardToolRate.mockRejectedValueOnce(new AppError('rate.limited', 'Slow down.'));
    expect(await optOutAction(null, form('someone'))).toMatchObject({ ok: false, error: { code: 'rate.limited' } });
    expect(optOutOfCountryIndex).not.toHaveBeenCalled();
  });
});
