import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'tick-secret-'.padEnd(48, 'x');

const runTickWithHandlers = vi.fn();
vi.mock('@/server/jobs', () => ({ runTickWithHandlers }));
vi.mock('@commitmates/env/server', () => ({ serverEnv: { JOB_TICK_SECRET: SECRET } }));
vi.mock('@commitmates/core', () => ({
  getSetting: vi.fn(() => Promise.resolve(45_000)),
  getLogger: () => ({ error: vi.fn() }),
}));

const { POST } = await import('./route');

const call = (headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost/api/jobs/tick', { method: 'POST', headers }));

describe('POST /api/jobs/tick', () => {
  beforeEach(() => {
    runTickWithHandlers.mockReset();
  });

  it('rejects a request without the secret', async () => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(runTickWithHandlers).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret, including one of a different length', async () => {
    expect((await call({ 'x-tick-secret': 'wrong' })).status).toBe(401);
    expect((await call({ 'x-tick-secret': SECRET.replace('x', 'y') })).status).toBe(401);
    expect(runTickWithHandlers).not.toHaveBeenCalled();
  });

  it('runs a tick with the budget from settings', async () => {
    runTickWithHandlers.mockResolvedValue({ claimed: 2, done: 2 });
    const response = await call({ 'x-tick-secret': SECRET });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, report: { claimed: 2, done: 2 } });
    expect(runTickWithHandlers).toHaveBeenCalledWith({ budgetMs: 45_000 });
  });

  it('answers 500 without leaking details when the tick throws', async () => {
    runTickWithHandlers.mockRejectedValue(new Error('database password is hunter2'));
    const response = await call({ 'x-tick-secret': SECRET });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
  });
});
