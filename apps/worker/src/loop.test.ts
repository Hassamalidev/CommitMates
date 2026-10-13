import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runLoop } from './loop';

describe('runLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once per interval until aborted', async () => {
    const controller = new AbortController();
    const run = vi.fn(() => Promise.resolve());
    const finished = runLoop({ run, intervalMs: () => 1000, signal: controller.signal, onError: vi.fn() });

    await vi.advanceTimersByTimeAsync(2500);
    expect(run).toHaveBeenCalledTimes(3);

    controller.abort();
    await expect(finished).resolves.toBe(3);
  });

  it('reports a failing iteration and keeps going', async () => {
    const controller = new AbortController();
    const onError = vi.fn();
    const failure = new Error('boom');
    const run = vi.fn<() => Promise<void>>().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const finished = runLoop({ run, intervalMs: () => 10, signal: controller.signal, onError });

    await vi.advanceTimersByTimeAsync(15);
    controller.abort();
    await finished;

    expect(onError).toHaveBeenCalledWith(failure);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does nothing when already aborted', async () => {
    const run = vi.fn(() => Promise.resolve());
    await expect(
      runLoop({ run, intervalMs: () => 10, signal: AbortSignal.abort(), onError: vi.fn() }),
    ).resolves.toBe(0);
    expect(run).not.toHaveBeenCalled();
  });
});
