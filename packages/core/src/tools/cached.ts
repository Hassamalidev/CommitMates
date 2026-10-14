import { getCachedAnalysis } from '@commitmates/db';

import { registerAllTools } from './definitions';
import { cacheKeyFor, getTool } from './service';

/**
 * A tool's stored result for an input, without starting anything: `null` when there is
 * no fresh result. Used where a page shows a result only if one exists (share images).
 */
export async function getCachedToolResult(slug: string, rawInput: unknown, now: Date = new Date()): Promise<unknown> {
  registerAllTools();
  const tool = getTool(slug);
  if (!tool) return null;
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) return null;
  const cached = await getCachedAnalysis(cacheKeyFor(tool, parsed.data), now);
  return cached?.result ?? null;
}
