'use server';

import { getOwnSecretScan, type StoredSecretFinding } from '@commitmates/core';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser } from '@/server/guards';

export type OwnSecretScan = {
  findings: StoredSecretFinding[];
  partial: boolean;
  filesScanned: number;
  computedAt: string;
} | null;

/**
 * The signed-in member's latest secret scan of their own account (CLAUDE.md §8 F3 "Privacy").
 * The session decides whose scan is read; nothing in the request can point at someone else's.
 */
export async function loadOwnSecretScan(): Promise<ActionResult<OwnSecretScan>> {
  return withAction('recruiter.loadOwnSecretScan', async () => {
    const member = await requireUser();
    const scan = await getOwnSecretScan(member.id);
    return scan ? { ...scan, computedAt: scan.computedAt.toISOString() } : null;
  })();
}
