import { describe, expect, it } from 'vitest';

const { sseFrame, sseResponse } = await import('./sse');

async function* twoEvents() {
  yield { event: 'progress', data: { step: 'Reading repos' } };
  await Promise.resolve();
  yield { event: 'done', data: { resultRef: 1 } };
}

describe('sseFrame', () => {
  it('formats an event frame', () => {
    expect(sseFrame('done', { a: 1 })).toBe('event: done\ndata: {"a":1}\n\n');
  });
});

describe('sseResponse', () => {
  it('streams every event with the SSE headers', async () => {
    const response = sseResponse(() => twoEvents(), new Request('http://localhost/x'));
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(await response.text()).toBe(
      'event: progress\ndata: {"step":"Reading repos"}\n\nevent: done\ndata: {"resultRef":1}\n\n',
    );
  });

  it('ends with a friendly error event when the source throws', async () => {
    // eslint-disable-next-line require-yield, @typescript-eslint/require-await
    async function* broken(): AsyncGenerator<{ event: string; data: unknown }> {
      throw new Error('connection string leaked');
    }
    const text = await sseResponse(() => broken(), new Request('http://localhost/x')).text();
    expect(text).toContain('event: error');
    expect(text).not.toContain('leaked');
  });

  it('passes an abort signal that fires when the client disconnects', async () => {
    const client = new AbortController();
    let seen: AbortSignal | undefined;
    const response = sseResponse((signal) => {
      seen = signal;
      return twoEvents();
    }, new Request('http://localhost/x', { signal: client.signal }));
    await response.text();
    client.abort();
    expect(seen?.aborted).toBe(true);
  });
});
