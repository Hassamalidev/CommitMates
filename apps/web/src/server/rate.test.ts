import { beforeEach, describe, expect, it, vi } from 'vitest';

const guardRate = vi.fn((_key: string, _prefix: string) => Promise.resolve());
const hashIp = vi.fn((ip: string) => Promise.resolve(`hash(${ip})`));
vi.mock('@commitmates/core', () => ({ guardRate, hashIp }));

const { clientIp, guardToolRate, guardWriteRate } = await import('./rate');

describe('clientIp', () => {
  it('takes the first forwarded address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-real-ip': ' 198.51.100.2 ' }))).toBe('198.51.100.2');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('guardToolRate', () => {
  beforeEach(() => {
    guardRate.mockClear();
  });

  it('limits by tool and hashed IP, never by raw IP', async () => {
    const ipHash = await guardToolRate('dev-card', new Headers({ 'x-forwarded-for': '203.0.113.7' }));
    expect(ipHash).toBe('hash(203.0.113.7)');
    expect(guardRate.mock.calls).toEqual([['tool:dev-card:ip:hash(203.0.113.7)', 'rate.tool']]);
  });

  it('adds a per-member bucket when signed in', async () => {
    await guardToolRate('compat', new Headers(), 'user-1');
    expect(guardRate.mock.calls.map((call) => call[0])).toEqual([
      'tool:compat:ip:hash(unknown)',
      'tool:compat:user:user-1',
    ]);
  });
});

describe('guardWriteRate', () => {
  it('uses the write bucket of the member', async () => {
    guardRate.mockClear();
    await guardWriteRate('user-9');
    expect(guardRate).toHaveBeenCalledWith('write:user-9', 'rate.write');
  });
});
