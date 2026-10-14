import { createHash } from 'node:crypto';

import {
  NotFoundError,
  ValidationError,
  getCachedAnalysis,
  getSetting,
  putCachedAnalysis,
  recordToolSession,
  type AnalysisKey,
  type SettingKey,
  type SettingKeys,
} from '@commitmates/db';
import { PRIORITY, enqueue } from '@commitmates/jobs';
import { z } from 'zod';

const MS_PER_HOUR = 60 * 60 * 1000; // allowed-literal: unit conversion
/** Characters of an ISO timestamp up to the hour: `YYYY-MM-DDTHH`. */
const ISO_HOUR_LENGTH = 13;
/** Characters of an ISO timestamp up to the day: `YYYY-MM-DD`. */
const ISO_DAY_LENGTH = 10;

/** `YYYY-MM-DDTHH` in UTC: the bucket in hourly idempotency keys (CLAUDE.md §5.4 job catalog). */
export const hourBucket = (now: Date) => now.toISOString().slice(0, ISO_HOUR_LENGTH);
/** `YYYY-MM-DD` in UTC: the bucket in daily idempotency keys. */
export const dayBucket = (now: Date) => now.toISOString().slice(0, ISO_DAY_LENGTH);

type HourSettingKey = { [K in SettingKey]: (typeof SettingKeys)[K] extends 'integer' ? K : never }[SettingKey];

/**
 * A day-one tool as the request pipeline sees it (CLAUDE.md §5.3): how to validate its
 * input, where its result is cached and which job computes it.
 */
export type ToolDefinition<I> = {
  /** URL segment: `/tools/<slug>` and `/api/tools/<slug>`. */
  slug: string;
  jobType: string;
  /** `analysis_cache.kind`. */
  cacheKind: string;
  input: z.ZodType<I>;
  /** Who or what the result is about, in canonical form (lowercased login, `owner/repo`, …). */
  subjectKey(input: I): string;
  /**
   * What changes the result without changing the subject: parts of the input, and for
   * results only one person may see, who asked.
   */
  params?(input: I, context: ToolRunContext): unknown;
  /** The job's idempotency key; the same request inside one bucket shares one job. */
  idempotencyKey(input: I, now: Date): string;
  /** The job payload, when it carries more than the input (for example who asked). Defaults to the input. */
  payload?(input: I, context: ToolRunContext): unknown;
  /** Hours a result stays cached. */
  ttlSetting: HourSettingKey;
};

/** What the request knows that the input does not say. */
export type ToolRunContext = {
  /** The signed-in member who started the run. */
  userId?: string | undefined;
};

const tools = new Map<string, ToolDefinition<unknown>>();

export function registerTool<I>(tool: ToolDefinition<I>): void {
  tools.set(tool.slug, tool);
}

export function getTool(slug: string): ToolDefinition<unknown> | undefined {
  return tools.get(slug);
}

export const registeredToolSlugs = (): string[] => [...tools.keys()];

/** Test helper. */
export function clearTools(): void {
  tools.clear();
}

/** Stable hash of a tool's parameters: key order does not change it. */
export function hashParams(params: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, stable(entry)]),
      );
    }
    return value;
  };
  if (params === undefined) return 'default';
  return createHash('sha256').update(JSON.stringify(stable(params))).digest('hex');
}

export function cacheKeyFor<I>(tool: ToolDefinition<I>, input: I, context: ToolRunContext = {}): AnalysisKey {
  return { kind: tool.cacheKind, subjectKey: tool.subjectKey(input), paramsHash: hashParams(tool.params?.(input, context)) };
}

export type ToolRun =
  | { status: 'done'; result: unknown; computedAt: string }
  | { status: 'queued'; jobId: string };

/**
 * Steps 1, 3 and 4 of the tool request lifecycle (CLAUDE.md §5.3): validate the input,
 * answer from the cache when a fresh result exists, otherwise enqueue the job. Rate
 * limiting (step 2) belongs to the caller, which knows the request.
 */
export async function startToolRun(
  slug: string,
  rawInput: unknown,
  options: ToolRunContext & { now?: Date } = {},
): Promise<ToolRun> {
  const tool = getTool(slug);
  if (!tool) throw new NotFoundError('tool.unknown', 'We do not have a tool by that name.');
  const input = parseToolInput(tool, rawInput);
  const now = options.now ?? new Date();

  const cached = await getCachedAnalysis(cacheKeyFor(tool, input, { userId: options.userId }), now);
  if (cached) return { status: 'done', result: cached.result, computedAt: cached.computedAt.toISOString() };

  const payload = tool.payload ? tool.payload(input, { userId: options.userId }) : input;
  const job = await enqueue(tool.jobType, payload, {
    idempotencyKey: tool.idempotencyKey(input, now),
    priority: PRIORITY.INTERACTIVE,
  });
  return { status: 'queued', jobId: job.id };
}

/** Parses a tool's input; the first problem becomes an inline form error. */
export function parseToolInput<I>(tool: ToolDefinition<I>, rawInput: unknown): I {
  const parsed = tool.input.safeParse(rawInput);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  const field = issue?.path.map(String).join('.');
  throw new ValidationError('tool.invalid_input', issue?.message ?? 'That input does not look right.', {
    cause: parsed.error,
    ...(field ? { field } : {}),
  });
}

const resultRefSchema = z.object({
  cache: z.object({ kind: z.string(), subjectKey: z.string(), paramsHash: z.string() }),
});

/** What a tool job stores in `jobs.result_ref`: a pointer to its `analysis_cache` row. */
export type ToolResultRef = z.infer<typeof resultRefSchema>;

/**
 * Stores a tool's result and returns the pointer for `JobOutcome.resultRef`. Results about
 * people who have not signed up never outlive `privacy.nonUserRawTtlHours` (CLAUDE.md §2.6).
 */
export async function storeToolResult<I>(
  tool: ToolDefinition<I>,
  input: I,
  result: unknown,
  options: { isMemberSubject: boolean; now: Date; context?: ToolRunContext },
): Promise<ToolResultRef> {
  const [ttlHours, nonUserTtlHours] = await Promise.all([
    getSetting(tool.ttlSetting),
    getSetting('privacy.nonUserRawTtlHours'),
  ]);
  const hours = options.isMemberSubject ? ttlHours : Math.min(ttlHours, nonUserTtlHours);
  const key = cacheKeyFor(tool, input, options.context);
  await putCachedAnalysis({
    ...key,
    result,
    isMemberSubject: options.isMemberSubject,
    computedAt: options.now,
    expiresAt: new Date(options.now.getTime() + hours * MS_PER_HOUR),
  });
  return { cache: key };
}

/** Follows a job's `result_ref` to the stored result. `null` when it points nowhere or has expired. */
export async function loadToolResult(resultRef: unknown, now: Date = new Date()): Promise<unknown> {
  const ref = resultRefSchema.safeParse(resultRef);
  if (!ref.success) return null;
  const cached = await getCachedAnalysis(ref.data.cache, now);
  return cached?.result ?? null;
}

export { recordToolSession };
