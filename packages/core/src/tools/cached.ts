import { getCachedAnalysis } from '@commitmates/db';

import { cacheKeyFor, type ToolDefinition } from './service';

/**
 * A tool's stored result for an input, without starting anything: `null` when the input
 * is not valid or there is no fresh result.
 */
export async function getCachedResult<I>(tool: ToolDefinition<I>, rawInput: unknown, now: Date = new Date()): Promise<unknown> {
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) return null;
  const cached = await getCachedAnalysis(cacheKeyFor(tool, parsed.data), now);
  return cached?.result ?? null;
}
