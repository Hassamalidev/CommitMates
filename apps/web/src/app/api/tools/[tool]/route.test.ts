import { beforeEach, describe, expect, it, vi } from 'vitest';

class AppError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
class ValidationError extends AppError {
  constructor(
    code: string,
    userMessage: string,
    readonly field?: string,
  ) {
    super(code, userMessage, 400);
  }
}
class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super('rate.limited', "You're going a bit fast. Try again in about 30 seconds.", 429);
  }
}

const tool = { slug: 'echo' };
const getTool = vi.fn((slug: string) => (slug === 'echo' ? tool : undefined));
const parseToolInput = vi.fn();
const startToolRun = vi.fn();
const recordToolSession = vi.fn(() => Promise.resolve());
const registerAllTools = vi.fn();
const registerAllHandlers = vi.fn();
const logError = vi.fn();
vi.mock('@commitmates/core', () => ({
  AppError,
  ValidationError,
  RateLimitedError,
  getTool,
  parseToolInput,
  startToolRun,
  recordToolSession,
  registerAllTools,
  registerAllHandlers,
  getLogger: () => ({ error: logError }),
}));

const afterCallbacks: (() => Promise<void>)[] = [];
vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => {
    afterCallbacks.push(callback);
  },
}));

const getCurrentMember = vi.fn<() => Promise<{ id: string } | null>>(() => Promise.resolve(null));
vi.mock('@/server/auth', () => ({ getCurrentMember }));
const startJobAfterResponse = vi.fn();
vi.mock('@/server/jobs', () => ({ startJobAfterResponse }));
const guardToolRate = vi.fn((_tool: string, _headers: Headers, _userId?: string) => Promise.resolve('ip-hash'));
vi.mock('@/server/rate', () => ({ guardToolRate }));
vi.mock('@commitmates/env/client', () => ({ clientEnv: { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' } }));

const { POST } = await import('./route');

const call = (slug: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost:3000' }) =>
  POST(
    new Request(`http://localhost:3000/api/tools/${slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ tool: slug }) },
  );

beforeEach(() => {
  afterCallbacks.length = 0;
  for (const mock of [parseToolInput, startToolRun, recordToolSession, startJobAfterResponse, guardToolRate, logError]) {
    mock.mockClear();
  }
  parseToolInput.mockReset();
  startToolRun.mockReset();
  guardToolRate.mockImplementation(() => Promise.resolve('ip-hash'));
  getCurrentMember.mockImplementation(() => Promise.resolve(null));
});

describe('POST /api/tools/[tool]', () => {
  it('rejects cross-site requests before doing anything', async () => {
    const response = await call('echo', { login: 'someone' }, { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(guardToolRate).not.toHaveBeenCalled();
    expect(startToolRun).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown tool and 400 for a body that is not JSON', async () => {
    expect((await call('nope', {})).status).toBe(404);
    const response = await call('echo', '{not json');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 'error', error: { code: 'request.invalid_body' } });
    expect(guardToolRate).not.toHaveBeenCalled();
  });

  it('validates before spending a rate-limit token and names the field', async () => {
    parseToolInput.mockImplementation(() => {
      throw new ValidationError('tool.invalid_input', 'Enter a GitHub username.', 'login');
    });
    const response = await call('echo', { login: '' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: 'error',
      error: { code: 'tool.invalid_input', message: 'Enter a GitHub username.', field: 'login' },
    });
    expect(guardToolRate).not.toHaveBeenCalled();
  });

  it('answers 429 with retry-after when the bucket is empty', async () => {
    guardToolRate.mockImplementation(() => Promise.reject(new RateLimitedError(30)));
    const response = await call('echo', { login: 'someone' });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(await response.json()).toMatchObject({ status: 'error', error: { code: 'rate.limited' } });
    expect(startToolRun).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it('queues the job, starts it after the response and records the session', async () => {
    startToolRun.mockResolvedValue({ status: 'queued', jobId: 'job-1' });
    const response = await call('echo', { login: 'someone' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'queued', jobId: 'job-1' });
    expect(registerAllTools).toHaveBeenCalled();
    expect(registerAllHandlers).toHaveBeenCalled();
    expect(guardToolRate.mock.calls[0]?.[0]).toBe('echo');
    expect(guardToolRate.mock.calls[0]?.[2]).toBeUndefined();
    expect(startToolRun).toHaveBeenCalledWith('echo', { login: 'someone' }, { userId: undefined });
    expect(startJobAfterResponse).toHaveBeenCalledWith('job-1');

    expect(recordToolSession).not.toHaveBeenCalled();
    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(recordToolSession).toHaveBeenCalledWith({ tool: 'echo', ipHashDay: 'ip-hash', userId: undefined });
  });

  it('answers from the cache without starting a job, and limits members per account too', async () => {
    getCurrentMember.mockImplementation(() => Promise.resolve({ id: 'user-1' }));
    startToolRun.mockResolvedValue({ status: 'done', result: { echoed: 'someone' }, computedAt: '2026-10-14T12:00:00.000Z' });
    const response = await call('echo', { login: 'someone' });
    expect(await response.json()).toMatchObject({ status: 'done', result: { echoed: 'someone' } });
    expect(startJobAfterResponse).not.toHaveBeenCalled();
    expect(guardToolRate.mock.calls[0]?.[2]).toBe('user-1');
    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(recordToolSession).toHaveBeenCalledWith({ tool: 'echo', ipHashDay: 'ip-hash', userId: 'user-1' });
  });

  it('accepts a same-host request behind a preview URL', async () => {
    startToolRun.mockResolvedValue({ status: 'queued', jobId: 'job-2' });
    const response = await call('echo', {}, { origin: 'https://preview.example.app', host: 'preview.example.app' });
    expect(response.status).toBe(200);
  });

  it('hides unexpected failures behind a reference and logs them', async () => {
    startToolRun.mockRejectedValue(new Error('connection string leaked'));
    const response = await call('echo', { login: 'someone' });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/^Something broke on our side\. We've logged it \(ref: [0-9a-f]{8}\)\.$/);
    expect(body.error.message).not.toContain('leaked');
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('logs, but does not fail, when the session cannot be recorded', async () => {
    startToolRun.mockResolvedValue({ status: 'queued', jobId: 'job-3' });
    recordToolSession.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    await call('echo', {});
    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
