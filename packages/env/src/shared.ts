import { z } from 'zod';

export type EnvIssue = {
  variable: string;
  problem: 'missing' | 'invalid';
  detail: string;
};

export type EnvSource = Record<string, string | undefined>;

/** Thrown when environment variables are missing or malformed. The message lists every problem. */
export class EnvError extends Error {
  readonly scope: string;
  readonly issues: readonly EnvIssue[];

  constructor(scope: string, issues: readonly EnvIssue[]) {
    super(formatEnvIssues(scope, issues));
    this.name = 'EnvError';
    this.scope = scope;
    this.issues = issues;
  }
}

export function formatEnvIssues(scope: string, issues: readonly EnvIssue[]): string {
  const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.problem} (${issue.detail})`);
  return [
    `Invalid ${scope} environment: ${issues.length} variable(s) need attention.`,
    ...lines,
    'Copy .env.example to .env.local and fill in the values (CLAUDE.md §14.1).',
  ].join('\n');
}

/** Treats empty and whitespace-only values as unset, the way `.env` files leave them. */
function normalize(source: EnvSource, keys: readonly string[]): EnvSource {
  const result: EnvSource = {};
  for (const key of keys) {
    const value = source[key]?.trim();
    result[key] = value === undefined || value === '' ? undefined : value;
  }
  return result;
}

function toIssues(error: z.ZodError, input: EnvSource): EnvIssue[] {
  return error.issues.map((issue) => {
    const variable = String(issue.path[0] ?? 'unknown');
    const missing = input[variable] === undefined;
    return {
      variable,
      problem: missing ? 'missing' : 'invalid',
      detail: missing ? 'not set' : issue.message,
    };
  });
}

/** Validates every variable of a schema at once and reports all problems together. */
export function parseEnv<S extends z.ZodObject>(scope: string, schema: S, source: EnvSource): z.infer<S> {
  const input = normalize(source, Object.keys(schema.shape));
  const result = schema.safeParse(input);
  if (!result.success) throw new EnvError(scope, toIssues(result.error, input));
  return result.data;
}

/**
 * A view of the environment that validates each variable the first time it is read.
 * Importing a module that uses it never throws, so builds and tests that do not touch
 * a variable do not need it. Startup code calls the matching `assert*Env()` to fail fast.
 */
export function lazyEnv<S extends z.ZodObject>(
  scope: string,
  schema: S,
  readSource: () => EnvSource,
  fallbacks: Partial<Record<keyof z.infer<S> & string, string>> = {},
): Readonly<z.infer<S>> {
  const cache = new Map<string, unknown>();
  const keys = Object.keys(schema.shape);
  const fallbackValues: EnvSource = fallbacks;

  const read = (key: string): unknown => {
    if (cache.has(key)) return cache.get(key);
    const field = schema.shape[key] as z.ZodType | undefined;
    if (!field) throw new EnvError(scope, [{ variable: key, problem: 'invalid', detail: 'not a known variable' }]);
    const input = normalize(readSource(), [key]);
    input[key] ??= fallbackValues[key];
    const result = field.safeParse(input[key]);
    if (!result.success) {
      throw new EnvError(
        scope,
        result.error.issues.map((issue) => ({
          variable: key,
          problem: input[key] === undefined ? 'missing' : 'invalid',
          detail: input[key] === undefined ? 'not set' : issue.message,
        })),
      );
    }
    cache.set(key, result.data);
    return result.data;
  };

  return new Proxy({} as Readonly<z.infer<S>>, {
    get: (_target, key) => (typeof key === 'string' ? read(key) : undefined),
    has: (_target, key) => typeof key === 'string' && keys.includes(key),
    ownKeys: () => keys,
    getOwnPropertyDescriptor: (_target, key) =>
      typeof key === 'string' && keys.includes(key)
        ? { enumerable: true, configurable: true, value: read(key) }
        : undefined,
  });
}

/** Bytes of key material in an AES-256 key. */
const AES_256_KEY_BYTES = 32;
/** Shortest accepted shared secret, in characters. */
const MIN_SECRET_CHARS = 32;

export const base64Key = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === AES_256_KEY_BYTES, {
    message: 'must be 32 bytes, base64-encoded (openssl rand -base64 32)',
  });

export const secret = z.string().min(MIN_SECRET_CHARS, `must be at least ${MIN_SECRET_CHARS} characters`);

export const positiveInt = z.coerce.number().int().positive();
