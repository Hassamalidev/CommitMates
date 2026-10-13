import { watchJob } from '@commitmates/core';
import { z } from 'zod';

import { sseResponse } from '@/server/sse';

export const dynamic = 'force-dynamic';
/** Seconds the host may keep this stream open; `jobs.sseMaxMs` must stay below it. */
export const maxDuration = 60;

const paramsSchema = z.object({ id: z.uuid() });

/** Progress of a job as Server-Sent Events (CLAUDE.md §5.3 step 6). Job ids are unguessable UUIDs. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return Response.json({ error: 'invalid job id' }, { status: 400 });
  return sseResponse((signal) => watchJob(params.data.id, { signal }), request);
}
