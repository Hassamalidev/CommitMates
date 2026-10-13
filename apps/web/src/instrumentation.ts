/**
 * Runs once when the server process starts. A missing or malformed variable stops
 * startup with the full list of problems instead of failing later, mid-request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertServerEnv } = await import('@commitmates/env/server');
  assertServerEnv();
}
