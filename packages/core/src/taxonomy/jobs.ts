import { normalizeTerm } from '@commitmates/algorithms';
import { SERVER_IDENTITY, githubFor } from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { dayBucket } from '../tools/service';

import { computeExpansion } from './service';

const payloadSchema = z.object({ term: z.string().min(1) });
type Payload = z.infer<typeof payloadSchema>;

/** Expands a search term the cache does not know yet (CLAUDE.md §8 F6), continuing while counts are fetched. */
export const taxonomyExpandJob: JobHandler<Payload> = {
  type: 'taxonomy_expand',
  schema: payloadSchema,
  priority: PRIORITY.USER_BG,
  async run(payload, ctx) {
    const result = await computeExpansion(payload.term, {
      client: githubFor(SERVER_IDENTITY, { now: ctx.now }),
      now: ctx.now(),
      deadline: ctx.deadline,
    });
    if (result.status === 'partial') return { kind: 'continue', payload };
    return { kind: 'done', resultRef: { term: result.expansion.term, items: result.expansion.items.length } };
  },
};

/** Queues an expansion once per term and day (CLAUDE.md §5.4 job catalog). */
export async function requestExpansion(rawTerm: string, now: Date = new Date()): Promise<void> {
  const normalized = normalizeTerm(rawTerm);
  if (!normalized) return;
  await enqueue('taxonomy_expand', { term: normalized.term }, { idempotencyKey: `taxonomy:${normalized.term}:${dayBucket(now)}` });
}
