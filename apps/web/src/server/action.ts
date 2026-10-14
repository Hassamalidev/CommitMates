import 'server-only';

import { randomBytes } from 'node:crypto';

import { AppError, ValidationError, getLogger } from '@commitmates/core';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';

import { actionsCopy } from '@/copy/actions';

/** What every Server Action returns (CLAUDE.md §10.3). Errors are data, so forms can show them inline. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; field?: string } };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });

/** Bytes of randomness in the reference shown to the user and written to the log. */
const REFERENCE_BYTES = 4;

/**
 * Wraps a Server Action body: expected errors (`AppError`, invalid input) become
 * `{ ok: false }` with a friendly message; anything else is logged with a reference id
 * and reported generically. Framework control flow (redirects, not-found) passes through.
 */
export function withAction<Args extends unknown[], T>(
  name: string,
  run: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<ActionResult<T>> {
  return async (...args) => {
    try {
      return ok(await run(...args));
    } catch (error) {
      unstable_rethrow(error);

      if (error instanceof AppError) {
        const field = error instanceof ValidationError ? error.field : undefined;
        return {
          ok: false,
          error: { code: error.code, message: error.userMessage, ...(field !== undefined ? { field } : {}) },
        };
      }
      if (error instanceof ZodError) {
        const field = error.issues[0]?.path[0];
        return {
          ok: false,
          error: {
            code: 'validation.invalid_input',
            message: actionsCopy.invalidInput,
            ...(typeof field === 'string' ? { field } : {}),
          },
        };
      }

      const reference = randomBytes(REFERENCE_BYTES).toString('hex');
      getLogger().error({ err: error, action: name, ref: reference }, 'server action failed');
      return { ok: false, error: { code: 'internal', message: actionsCopy.unexpected(reference) } };
    }
  };
}
