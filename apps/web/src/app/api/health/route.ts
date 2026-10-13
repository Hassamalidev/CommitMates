import { NextResponse } from 'next/server';

import { getAppVersion } from '@/lib/version';

export const dynamic = 'force-dynamic';

export type HealthResponse = {
  status: 'ok';
  version: string;
  commit: string | null;
  time: string;
};

/** Liveness probe for uptime monitors: build version and the server's clock. */
export function GET(): NextResponse<HealthResponse> {
  return NextResponse.json(
    { status: 'ok', ...getAppVersion(), time: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
