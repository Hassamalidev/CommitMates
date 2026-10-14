import { RateLimitError, getDb, getSetting, schema, type DbOrTx } from '@commitmates/db';
import { eq } from 'drizzle-orm';

const { registryPacing } = schema;

export type RegistryPaceOptions = {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Longest pause worth taking inline; a longer one becomes a `RateLimitError` so the job waits instead. */
  maxWaitMs: number;
};

/**
 * Runs `call` while holding the registry's row lock, at least
 * `sources.registry.minIntervalMs` after the previous call. One request is in flight
 * per registry across every process (CLAUDE.md §2.5, §6.6).
 */
export async function withRegistryPace<T>(
  registry: string,
  options: RegistryPaceOptions,
  call: () => Promise<T>,
  db: DbOrTx = getDb(),
): Promise<T> {
  const minIntervalMs = await getSetting('sources.registry.minIntervalMs', db);
  type Outcome = { ok: true; value: T } | { ok: false; error: unknown };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    await tx.insert(registryPacing).values({ registry }).onConflictDoNothing();
    const [row] = await tx.select().from(registryPacing).where(eq(registryPacing.registry, registry)).for('update');

    if (row?.lastCallAt) {
      const waitMs = row.lastCallAt.getTime() + minIntervalMs - options.now().getTime();
      if (waitMs > options.maxWaitMs) throw new RateLimitError(new Date(options.now().getTime() + waitMs), { resource: registry });
      if (waitMs > 0) await options.sleep(waitMs);
    }

    // A failing call must not roll the timestamp back: the registry still received a
    // request. The error is carried out of the transaction and rethrown after it commits.
    let result: Outcome;
    try {
      result = { ok: true, value: await call() };
    } catch (error) {
      result = { ok: false, error };
    }
    await tx.update(registryPacing).set({ lastCallAt: options.now() }).where(eq(registryPacing.registry, registry));
    return result;
  });

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
