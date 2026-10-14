import { describe, expect, it, vi } from 'vitest';

const loadToolResult = vi.fn((ref: unknown) => Promise.resolve(ref === 'pointer' ? { score: 80 } : null));
vi.mock('@commitmates/core', () => ({ loadToolResult }));

const { withResults } = await import('./job-events');
const { sseResponse } = await import('./sse');

// eslint-disable-next-line @typescript-eslint/require-await
async function* run(resultRef: unknown) {
  yield { event: 'progress' as const, data: { status: 'running' as const, progress: { step: 'repos' } } };
  yield { event: 'waiting' as const, data: { until: '2026-10-14T12:03:00.000Z', progress: null } };
  yield { event: 'done' as const, data: { resultRef } };
}

describe('withResults', () => {
  it('passes progress through and replaces the result pointer with the result', async () => {
    const response = sseResponse(() => withResults(run('pointer')), new Request('http://localhost/x'));
    expect(await response.text()).toBe(
      'event: progress\ndata: {"status":"running","progress":{"step":"repos"}}\n\n' +
        'event: waiting\ndata: {"until":"2026-10-14T12:03:00.000Z","progress":null}\n\n' +
        'event: done\ndata: {"result":{"score":80}}\n\n',
    );
  });

  it('delivers null for a job without a stored result', async () => {
    const events = [];
    for await (const event of withResults(run(undefined))) events.push(event);
    expect(events.at(-1)).toEqual({ event: 'done', data: { result: null } });
  });
});
