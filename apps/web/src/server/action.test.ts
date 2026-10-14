import type * as Core from '@commitmates/core';
import { ForbiddenError, ValidationError } from '@commitmates/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const logged = vi.fn();
vi.mock('@commitmates/core', async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  getLogger: () => ({ error: logged }),
}));
vi.mock('next/navigation', () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error;
  },
}));

const { ok, withAction } = await import('./action');

describe('withAction', () => {
  it('wraps a successful result', async () => {
    const action = withAction('double', (n: number) => Promise.resolve(n * 2));
    expect(await action(21)).toEqual(ok(42));
  });

  it('maps an AppError to its code and friendly message', async () => {
    const action = withAction('guarded', () => Promise.reject(new ForbiddenError('auth.forbidden', "You don't have access to that.")));
    expect(await action()).toEqual({
      ok: false,
      error: { code: 'auth.forbidden', message: "You don't have access to that." },
    });
  });

  it('carries the field of a validation error', async () => {
    const action = withAction('validate', () =>
      Promise.reject(new ValidationError('admin.setting_not_json', 'Enter the value as JSON.', { field: 'value' })),
    );
    expect(await action()).toEqual({
      ok: false,
      error: { code: 'admin.setting_not_json', message: 'Enter the value as JSON.', field: 'value' },
    });
  });

  it('maps a zod failure to a generic input message with the first field', async () => {
    const schema = z.object({ name: z.string().min(1) });
    const action = withAction('parse', (input: unknown) => Promise.resolve(schema.parse(input)));
    const result = await action({ name: '' });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation.invalid_input', field: 'name' } });
  });

  it('logs unexpected errors with a reference and hides the detail', async () => {
    logged.mockClear();
    const action = withAction('explode', () => Promise.reject(new Error('password=hunter2')));
    const result = await action();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal');
    expect(result.error.message).not.toContain('hunter2');
    const reference = /ref: ([0-9a-f]{8})/.exec(result.error.message)?.[1];
    expect(reference).toBeDefined();
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ action: 'explode', ref: reference }), 'server action failed');
  });

  it('lets framework control flow through', async () => {
    const action = withAction('redirecting', () => Promise.reject(new Error('NEXT_REDIRECT')));
    await expect(action()).rejects.toThrow('NEXT_REDIRECT');
  });
});
