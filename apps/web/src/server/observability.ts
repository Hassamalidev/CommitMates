import 'server-only';

import { randomUUID } from 'node:crypto';

import { getLogger } from '@commitmates/core';

/**
 * Optional error tracking (CLAUDE.md §5.13). Sentry's SDK pulls in packages under
 * licenses outside our allow-list, so events are posted to Sentry's envelope endpoint
 * directly. An event is built from scratch with only the fields below, which is how
 * personal data is kept out: there is no user, cookie, header, body or query string
 * to strip because none is ever added.
 */

type Target = { url: string };

/** Longest error message and stack text sent. */
const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 4000;
/** Milliseconds allowed for the report; error tracking must never slow a response down. */
const REPORT_TIMEOUT_MS = 2000;
const MS_PER_SECOND = 1000;

/** Parses a Sentry DSN (`https://<key>@<host>/<project>`) into its envelope endpoint. */
export function parseDsn(dsn: string | undefined): Target | null {
  if (!dsn) return null;
  try {
    const parsed = new URL(dsn);
    const project = parsed.pathname.replace(/^\/+|\/+$/g, '');
    if (parsed.protocol !== 'https:' || parsed.username === '' || !/^\d+$/.test(project)) return null;
    const endpoint = new URL(`/api/${project}/envelope/`, `https://${parsed.host}`);
    endpoint.searchParams.set('sentry_key', parsed.username);
    endpoint.searchParams.set('sentry_version', '7');
    return { url: endpoint.toString() };
  } catch {
    return null;
  }
}

export type ErrorEvent = {
  event_id: string;
  timestamp: number;
  platform: 'node';
  level: 'error';
  exception: { values: [{ type: string; value: string }] };
  tags: Record<string, string>;
  extra: { stack?: string };
};

/** Builds the event: error type, message, stack and route tags. Nothing about the person. */
export function buildErrorEvent(error: unknown, tags: Record<string, string | undefined>, now: Date): ErrorEvent {
  const isError = error instanceof Error;
  const cleanTags: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value !== undefined) cleanTags[key] = value;
  }
  return {
    event_id: randomUUID().replaceAll('-', ''),
    timestamp: now.getTime() / MS_PER_SECOND,
    platform: 'node',
    level: 'error',
    exception: {
      values: [
        {
          type: isError ? error.name : 'NonError',
          value: (isError ? error.message : String(error)).slice(0, MAX_MESSAGE_CHARS),
        },
      ],
    },
    tags: cleanTags,
    extra: isError && error.stack ? { stack: error.stack.slice(0, MAX_STACK_CHARS) } : {},
  };
}

let target: Target | null = null;

/** Enables error tracking only when `SENTRY_DSN` is set and valid. Without it nothing is sent anywhere. */
export function initErrorTracking(dsn: string | undefined): boolean {
  target = parseDsn(dsn);
  if (dsn && !target) getLogger().warn('SENTRY_DSN is set but is not a valid DSN; error tracking is off');
  return target !== null;
}

async function send(event: ErrorEvent, destination: Target): Promise<void> {
  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  try {
    await fetch(destination.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: envelope,
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
  } catch (sendError) {
    getLogger().warn({ err: sendError }, 'could not report an error to the tracker');
  }
}

export type RequestErrorContext = { path: string; method: string; routePath?: string; routeType?: string };

/** Logs a server-side request error with its digest and route, never with headers or the body. */
export async function reportRequestError(error: unknown, context: RequestErrorContext): Promise<void> {
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String(error.digest) : undefined;
  const route = context.routePath ?? context.path.split('?')[0];
  getLogger().error({ err: error, digest, method: context.method, route, routeType: context.routeType }, 'request failed');
  if (target) await send(buildErrorEvent(error, { route, method: context.method, digest }, new Date()), target);
}
