import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logged = { error: vi.fn(), warn: vi.fn() };
vi.mock('@commitmates/core', () => ({ getLogger: () => logged }));

const { buildErrorEvent, initErrorTracking, parseDsn, reportRequestError } = await import('./observability');

const DSN = 'https://publickey@o123.ingest.sentry.io/456';
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  logged.error.mockClear();
  logged.warn.mockClear();
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  initErrorTracking(undefined);
  vi.unstubAllGlobals();
});

describe('parseDsn', () => {
  it('builds the envelope endpoint', () => {
    expect(parseDsn(DSN)).toEqual({
      url: 'https://o123.ingest.sentry.io/api/456/envelope/?sentry_key=publickey&sentry_version=7',
    });
  });

  it('rejects anything that is not a DSN', () => {
    for (const value of [undefined, '', 'not a url', 'http://key@host/1', 'https://host/1', 'https://key@host/project']) {
      expect(parseDsn(value)).toBeNull();
    }
  });
});

describe('buildErrorEvent', () => {
  it('contains the error and route tags and nothing about a person', () => {
    const event = buildErrorEvent(new TypeError('boom'), { route: '/tools/[tool]', digest: undefined }, new Date(0));
    expect(event.exception.values[0]).toEqual({ type: 'TypeError', value: 'boom' });
    expect(event.tags).toEqual({ route: '/tools/[tool]' });
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(Object.keys(event).sort()).toEqual(['event_id', 'exception', 'extra', 'level', 'platform', 'tags', 'timestamp']);
  });

  it('handles thrown non-errors and truncates long messages', () => {
    expect(buildErrorEvent('plain', {}, new Date()).exception.values[0]).toEqual({ type: 'NonError', value: 'plain' });
    const long = buildErrorEvent(new Error('x'.repeat(2000)), {}, new Date());
    expect(long.exception.values[0].value).toHaveLength(500);
  });
});

describe('reportRequestError', () => {
  const error = Object.assign(new Error('boom'), { digest: 'abc123' });

  it('logs the route without the query string and sends nothing when tracking is off', async () => {
    expect(initErrorTracking(undefined)).toBe(false);
    await reportRequestError(error, { path: '/auth/callback?code=secret', method: 'GET' });
    expect(logged.error).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'abc123', method: 'GET', route: '/auth/callback' }),
      'request failed',
    );
    expect(JSON.stringify(logged.error.mock.calls[0]?.[0])).not.toContain('secret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts an envelope when a DSN is configured', async () => {
    expect(initErrorTracking(DSN)).toBe(true);
    await reportRequestError(error, { path: '/home?x=1', method: 'GET', routePath: '/home' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(typeof url === 'string' ? url : '').toContain('/api/456/envelope/');
    const body = typeof init?.body === 'string' ? init.body : '';
    const lines = body.split('\n');
    expect(lines).toHaveLength(3);
    const event = JSON.parse(lines[2]!) as { tags: Record<string, string>; user?: unknown; request?: unknown };
    expect(event.tags).toEqual({ route: '/home', method: 'GET', digest: 'abc123' });
    expect(event.user).toBeUndefined();
    expect(event.request).toBeUndefined();
    expect(body).not.toContain('x=1');
  });

  it('never throws when the tracker is unreachable', async () => {
    initErrorTracking(DSN);
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(reportRequestError(error, { path: '/', method: 'GET' })).resolves.toBeUndefined();
    expect(logged.warn).toHaveBeenCalled();
  });

  it('warns about a malformed DSN and stays off', () => {
    expect(initErrorTracking('https://example.com/nope')).toBe(false);
    expect(logged.warn).toHaveBeenCalled();
  });
});
