import { partnerTodayStatus, type Member } from '@commitmates/core';

import { streaksCopy } from '@/copy/streaks';

/**
 * Whether the partner has coded today (CLAUDE.md §8 F13 "UI"), only when they allow it. Rendered in a
 * Suspense boundary, because it may ask GitHub; nothing is shown when the answer is private or unknown.
 */
export async function PartnerToday({ member, pairId, name }: { member: Member; pairId: string; name: string }) {
  const status = await partnerTodayStatus(member, { pairId }).catch(() => 'unknown' as const);
  if (status === 'private' || status === 'unknown') return null;
  return (
    <p role="status" className="type-small">
      {streaksCopy.today[status](name)}
    </p>
  );
}
