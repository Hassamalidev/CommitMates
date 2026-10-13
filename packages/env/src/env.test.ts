import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseClientEnv } from './client';
import { assertServerEnv } from './server';
import { EnvError, lazyEnv } from './shared';
import { localTestEnv } from './test-values';
import { assertWorkerEnv } from './worker';

function catchEnvError(run: () => unknown): EnvError {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error('expected an EnvError');
}

describe('assertServerEnv', () => {
  it('accepts a complete environment and coerces numbers', () => {
    const env = assertServerEnv(localTestEnv());
    expect(env.SMTP_PORT).toBe(54325);
    expect(env.TOKEN_ENCRYPTION_KEY_VERSION).toBe(1);
    expect(env.BOOTSTRAP_ADMIN_GITHUB_ID).toBe(1);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('lists every missing variable at once', () => {
    const error = catchEnvError(() => assertServerEnv({}));
    const missing = error.issues.filter((issue) => issue.problem === 'missing').map((issue) => issue.variable);
    expect(missing).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'GITHUB_SERVER_TOKEN', 'JOB_TICK_SECRET', 'NEXT_PUBLIC_SITE_URL']),
    );
    expect(missing).not.toContain('SENTRY_DSN');
    expect(missing).not.toContain('SMTP_USER');
    expect(error.message).toContain('DATABASE_URL: missing');
    expect(error.message).toContain('.env.example');
  });

  it('treats empty strings as missing', () => {
    const error = catchEnvError(() => assertServerEnv(localTestEnv({ GITHUB_SERVER_TOKEN: '  ' })));
    expect(error.issues).toEqual([expect.objectContaining({ variable: 'GITHUB_SERVER_TOKEN', problem: 'missing' })]);
  });

  it('rejects malformed values', () => {
    const error = catchEnvError(() =>
      assertServerEnv(
        localTestEnv({
          TOKEN_ENCRYPTION_KEY: 'too-short',
          DATABASE_URL: 'https://example.com',
          JOB_TICK_SECRET: 'short',
          SMTP_PORT: 'abc',
          LOG_LEVEL: 'loud',
        }),
      ),
    );
    expect(error.issues.map((issue) => issue.variable).sort()).toEqual([
      'DATABASE_URL',
      'JOB_TICK_SECRET',
      'LOG_LEVEL',
      'SMTP_PORT',
      'TOKEN_ENCRYPTION_KEY',
    ]);
    expect(error.issues.every((issue) => issue.problem === 'invalid')).toBe(true);
  });

  it('never echoes a value in the message', () => {
    const error = catchEnvError(() => assertServerEnv(localTestEnv({ JOB_TICK_SECRET: 'hunter2' })));
    expect(error.message).not.toContain('hunter2');
  });
});

describe('assertWorkerEnv', () => {
  it('does not need web-only variables', () => {
    const env = localTestEnv({
      SUPABASE_SECRET_KEY: undefined,
      JOB_TICK_SECRET: undefined,
      BOOTSTRAP_ADMIN_GITHUB_ID: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
    });
    expect(assertWorkerEnv(env).DATABASE_URL).toContain('54322');
    expect(() => assertServerEnv(env)).toThrow(EnvError);
  });
});

describe('parseClientEnv', () => {
  it('requires the public variables', () => {
    const error = catchEnvError(() => parseClientEnv({}));
    expect(error.issues).toHaveLength(4);
  });
});

describe('lazyEnv', () => {
  const schema = z.object({ A: z.string().min(1), B: z.coerce.number().int(), C: z.string().min(1) });

  it('validates only the variable that is read', () => {
    const env = lazyEnv('test', schema, () => ({ A: 'value' }));
    expect(env.A).toBe('value');
    expect(() => env.B).toThrow(EnvError);
  });

  it('caches a value after the first read', () => {
    const source: Record<string, string | undefined> = { B: '4' };
    const env = lazyEnv('test', schema, () => source);
    expect(env.B).toBe(4);
    source.B = '5';
    expect(env.B).toBe(4);
  });

  it('uses a fallback only when the variable is unset', () => {
    expect(lazyEnv('test', schema, () => ({}), { C: 'fallback' }).C).toBe('fallback');
    expect(lazyEnv('test', schema, () => ({ C: 'real' }), { C: 'fallback' }).C).toBe('real');
  });

  it('enumerates its keys', () => {
    expect(Object.keys(lazyEnv('test', schema, () => ({ A: 'a', B: '1', C: 'c' })))).toEqual(['A', 'B', 'C']);
  });
});
