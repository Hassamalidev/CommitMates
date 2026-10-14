import { randomBytes } from 'node:crypto';

import {
  AppError,
  RateLimitedError,
  ValidationError,
  getLogger,
  getTool,
  parseToolInput,
  recordToolSession,
  registerAllHandlers,
  registerAllTools,
  startToolRun,
} from '@commitmates/core';
import { after } from 'next/server';

import { toolsCopy } from '@/copy/tools';
import { getCurrentMember } from '@/server/auth';
import { startJobAfterResponse } from '@/server/jobs';
import { isSameOrigin } from '@/server/origin';
import { guardToolRate } from '@/server/rate';

export const dynamic = 'force-dynamic';

/** HTTP statuses (protocol constants). */
const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const INTERNAL_ERROR = 500;
/** Bytes of randomness in the reference shown to the visitor and written to the log. */
const REFERENCE_BYTES = 4;

type ErrorBody = { code: string; message: string; field?: string };

const failure = (status: number, error: ErrorBody, headers?: Record<string, string>) =>
  Response.json({ status: 'error', error }, { status, ...(headers ? { headers } : {}) });

/**
 * Starts a day-one tool (CLAUDE.md §5.3): validate, rate limit, answer from the cache or
 * enqueue the job, then start it right after the response instead of waiting for the next tick.
 */
export async function POST(request: Request, context: { params: Promise<{ tool: string }> }): Promise<Response> {
  if (!isSameOrigin(request)) {
    return failure(FORBIDDEN, { code: 'request.cross_site', message: toolsCopy.errors.crossSite });
  }

  registerAllTools();
  registerAllHandlers();
  const { tool: slug } = await context.params;
  const tool = getTool(slug);
  if (!tool) return failure(NOT_FOUND, { code: 'tool.unknown', message: toolsCopy.errors.unknownTool });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(BAD_REQUEST, { code: 'request.invalid_body', message: toolsCopy.errors.invalidBody });
  }

  try {
    parseToolInput(tool, body);
    const member = await getCurrentMember();
    const ipHash = await guardToolRate(slug, request.headers, member?.id);
    const run = await startToolRun(slug, body, { userId: member?.id });

    after(async () => {
      try {
        await recordToolSession({ tool: slug, ipHashDay: ipHash, userId: member?.id });
      } catch (error) {
        getLogger().error({ err: error, tool: slug }, 'tool session not recorded');
      }
    });
    if (run.status === 'queued') startJobAfterResponse(run.jobId);
    return Response.json(run);
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return failure(
        error.status,
        { code: error.code, message: error.userMessage },
        { 'Retry-After': String(error.retryAfterSeconds) },
      );
    }
    if (error instanceof AppError) {
      const field = error instanceof ValidationError ? error.field : undefined;
      return failure(error.status, {
        code: error.code,
        message: error.userMessage,
        ...(field !== undefined ? { field } : {}),
      });
    }
    const reference = randomBytes(REFERENCE_BYTES).toString('hex');
    getLogger().error({ err: error, tool: slug, ref: reference }, 'tool request failed');
    return failure(INTERNAL_ERROR, { code: 'internal', message: toolsCopy.errors.failed(reference) });
  }
}
