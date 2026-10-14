/**
 * Runs once when the server process starts. A missing or malformed variable stops
 * startup with the full list of problems instead of failing later, mid-request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertServerEnv } = await import('@commitmates/env/server');
  const env = assertServerEnv();
  const { initErrorTracking } = await import('@/server/observability');
  initErrorTracking(env.SENTRY_DSN);
}

/** Called by Next.js for every uncaught server error: one place to log and report them. */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportRequestError } = await import('@/server/observability');
  await reportRequestError(error, { path: request.path, method: request.method, ...context });
}
