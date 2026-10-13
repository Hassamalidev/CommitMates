import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('GET /api/health', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the version and the server time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T08:30:00.000Z'));

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({ status: 'ok', time: '2026-10-14T08:30:00.000Z' });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
