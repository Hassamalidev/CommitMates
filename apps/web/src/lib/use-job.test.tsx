// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useJob } from './use-job';

type Result = { echoed: string };
const parseResult = (value: unknown): Result | null =>
  typeof value === 'object' && value !== null && typeof (value as Result).echoed === 'string' ? (value as Result) : null;

/** A stand-in for the browser's EventSource that the test drives by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((event: Event) => void)[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (event: Event) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  /** A named frame from the server. */
  send(name: string, data: unknown): void {
    const event = new MessageEvent(name, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  /** The connection dropped; the browser fires a plain `error` event. */
  drop(): void {
    for (const listener of this.listeners.get('error') ?? []) listener(new Event('error'));
  }
}

const latest = () => {
  const instance = FakeEventSource.instances.at(-1);
  if (!instance) throw new Error('no EventSource was opened');
  return instance;
};

const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));

beforeEach(() => {
  FakeEventSource.instances = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const JOB = '6f1c1a0e-8a55-4d38-9a0e-2f8b5d0c7e11';

describe('useJob', () => {
  it('goes through idle, working, waiting, working and done for a queued run', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'queued', jobId: JOB }));
    const { result } = renderHook(() => useJob('echo', parseResult));
    expect(result.current.state).toEqual({ phase: 'idle' });

    act(() => {
      result.current.start({ login: 'someone' });
    });
    expect(result.current.state).toEqual({ phase: 'working', queued: true, progress: null });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"login":"someone"}',
    });
    expect(latest().url).toBe(`/api/jobs/${JOB}/events`);

    act(() => {
      latest().send('progress', { status: 'running', progress: { step: 'finding', pct: 25 } });
    });
    expect(result.current.state).toEqual({ phase: 'working', queued: false, progress: { step: 'finding', pct: 25 } });

    act(() => {
      latest().send('waiting', { until: '2026-10-14T12:03:00.000Z', progress: { step: 'finding', pct: 25 } });
    });
    expect(result.current.state).toMatchObject({ phase: 'waiting', until: '2026-10-14T12:03:00.000Z' });

    act(() => {
      latest().send('progress', { status: 'running', progress: { step: 'building' } });
    });
    expect(result.current.state).toMatchObject({ phase: 'working', progress: { step: 'building' } });

    act(() => {
      latest().send('done', { result: { echoed: 'someone' } });
    });
    expect(result.current.state).toEqual({ phase: 'done', result: { echoed: 'someone' } });
    expect(latest().closed).toBe(true);
  });

  it('shows a cached result without opening a stream', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: { echoed: 'cached' }, computedAt: 'x' }));
    const { result } = renderHook(() => useJob('echo', parseResult));
    act(() => {
      result.current.start({ login: 'cached' });
    });
    await waitFor(() => {
      expect(result.current.state).toEqual({ phase: 'done', result: { echoed: 'cached' } });
    });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('shows validation and rate-limit errors from the start request', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'error', error: { code: 'c', message: 'Check the login.', field: 'login' } }, 400));
    const { result } = renderHook(() => useJob('echo', parseResult));
    act(() => {
      result.current.start({ login: '' });
    });
    await waitFor(() => {
      expect(result.current.state).toEqual({ phase: 'error', message: 'Check the login.', field: 'login' });
    });
  });

  it('shows the job error sent on the stream', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'queued', jobId: JOB }));
    const { result } = renderHook(() => useJob('echo', parseResult));
    act(() => {
      result.current.start({ login: 'ghost' });
    });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      latest().send('error', { message: "We couldn't find @ghost on GitHub. Check the spelling?" });
    });
    expect(result.current.state).toEqual({ phase: 'error', message: "We couldn't find @ghost on GitHub. Check the spelling?" });
    expect(latest().closed).toBe(true);
  });

  it('reports a network failure, a malformed reply and an unusable result', async () => {
    const { result } = renderHook(() => useJob('echo', parseResult));

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    act(() => {
      result.current.start({});
    });
    await waitFor(() => {
      expect(result.current.state).toMatchObject({ phase: 'error', message: expect.stringContaining("couldn't reach") as string });
    });

    fetchMock.mockReturnValueOnce(reply({ nonsense: true }));
    act(() => {
      result.current.start({});
    });
    await waitFor(() => {
      expect(result.current.state).toMatchObject({ phase: 'error', message: expect.stringContaining('broke on our side') as string });
    });

    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: { wrong: 'shape' } }));
    act(() => {
      result.current.start({});
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.current.state).toMatchObject({ phase: 'error', message: expect.stringContaining('broke on our side') as string });
    });
  });

  it('continues on a new connection when the server ends one', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'queued', jobId: JOB }));
    const { result } = renderHook(() => useJob('echo', parseResult));
    act(() => {
      result.current.start({});
    });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const first = latest();
    act(() => {
      first.send('timeout', {});
    });
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => {
      latest().send('done', { result: { echoed: 'late' } });
    });
    expect(result.current.state).toEqual({ phase: 'done', result: { echoed: 'late' } });
  });

  it('tolerates a few dropped connections, then gives up', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'queued', jobId: JOB }));
    const { result } = renderHook(() => useJob('echo', parseResult));
    act(() => {
      result.current.start({});
    });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      for (let drop = 0; drop < 4; drop += 1) latest().drop();
    });
    expect(result.current.state.phase).toBe('working');
    // A frame that arrives resets the count.
    act(() => {
      latest().send('progress', { status: 'running', progress: null });
      for (let drop = 0; drop < 4; drop += 1) latest().drop();
    });
    expect(result.current.state.phase).toBe('working');
    act(() => {
      latest().drop();
    });
    expect(result.current.state).toMatchObject({ phase: 'error', message: expect.stringContaining('lost the connection') as string });
    expect(latest().closed).toBe(true);
  });

  it('ignores a replaced run and closes the stream on reset and unmount', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'queued', jobId: JOB }));
    const { result, unmount } = renderHook(() => useJob('echo', parseResult));
    act(() => {
      result.current.start({ login: 'first' });
    });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const first = latest();

    fetchMock.mockReturnValueOnce(reply({ status: 'queued', jobId: JOB }));
    act(() => {
      result.current.start({ login: 'second' });
    });
    expect(first.closed).toBe(true);
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2);
    });
    act(() => {
      first.send('done', { result: { echoed: 'first' } });
    });
    expect(result.current.state.phase).toBe('working');

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toEqual({ phase: 'idle' });
    expect(latest().closed).toBe(true);

    fetchMock.mockReturnValueOnce(reply({ status: 'queued', jobId: JOB }));
    act(() => {
      result.current.start({ login: 'third' });
    });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(3);
    });
    unmount();
    expect(latest().closed).toBe(true);
  });
});
