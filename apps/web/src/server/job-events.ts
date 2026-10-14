import 'server-only';

import { loadToolResult, type JobEvent } from '@commitmates/core';

/**
 * A finished tool job points at its stored result; the stream delivers the result itself,
 * so the page needs no second request. Jobs without a stored result deliver `null`.
 */
export async function* withResults(events: AsyncIterable<JobEvent>): AsyncGenerator<{ event: string; data: unknown }> {
  for await (const event of events) {
    if (event.event === 'done') {
      yield { event: 'done', data: { result: await loadToolResult(event.data.resultRef) } };
    } else {
      yield event;
    }
  }
}
