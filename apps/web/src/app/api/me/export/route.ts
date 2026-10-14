import { RateLimitedError, exportMemberData } from '@commitmates/core';

import { getCurrentMember } from '@/server/auth';
import { guardWriteRate } from '@/server/rate';

export const dynamic = 'force-dynamic';

/** HTTP status for a request without a session (protocol constant). */
const UNAUTHORIZED = 401;

/** Every class A and B row of the signed-in member as one JSON download (CLAUDE.md §5.12 "Export"). */
export async function GET(): Promise<Response> {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'sign_in_required' }, { status: UNAUTHORIZED });
  try {
    await guardWriteRate(member.id);
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    return Response.json(
      { error: { code: error.code, message: error.userMessage } },
      { status: error.status, headers: { 'retry-after': String(error.retryAfterSeconds) } },
    );
  }
  const now = new Date();
  const data = await exportMemberData(member, now);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="commitmates-export-${now.toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
