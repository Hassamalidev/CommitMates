/**
 * Runs `task` over `items` with at most `limit` running at once and returns the results in input
 * order. GitHub allows up to 100 concurrent requests per token; callers pass `github.concurrency`,
 * a much smaller number, so one job cannot crowd out others or trip secondary rate limits (ADR-014).
 * After the first failure no new task starts; it is thrown once the running tasks have settled.
 */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (failures.length === 0 && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await task(items[index] as T, index);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failures.length > 0) throw failures[0];
  return results;
}

/** Splits `items` into consecutive batches of `size`, for loops that check a deadline between batches. */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, size);
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += step) out.push(items.slice(start, start + step));
  return out;
}
