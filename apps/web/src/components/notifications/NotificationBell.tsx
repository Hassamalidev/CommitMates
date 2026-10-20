'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { notificationsCopy } from '@/copy/notifications';
import { notificationBadgeAction } from '@/server/actions/notifications';

/**
 * The header's link to the notification center with the unread count (CLAUDE.md §7.5). The count is
 * read on every page change and again whenever Supabase Realtime announces a new notification for
 * this member (Row Level Security lets each member see only their own), so muted kinds stay out.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    void notificationBadgeAction().then((result) => {
      if (result.ok) setCount(result.data);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    let active = true;
    // Read through a function: the flag changes while the awaits below are pending.
    const isActive = () => active;
    let cleanup: (() => void) | null = null;
    // Loaded only for members, so public pages never ship the Supabase client.
    void import('@/lib/supabase/browser')
      .then(async ({ createSupabaseBrowserClient }) => {
        // The header may unmount while the client loads; then nothing is set up.
        if (!isActive()) return;
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!isActive()) return;
        if (data.session) void supabase.realtime.setAuth(data.session.access_token);
        const channel = supabase
          .channel(`notifications:${userId}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, refresh)
          .subscribe();
        cleanup = () => {
          void supabase.removeChannel(channel);
        };
      })
      // Without live updates the badge still refreshes on every page change.
      .catch(() => undefined);
    return () => {
      active = false;
      cleanup?.();
    };
  }, [userId, refresh]);

  const copy = notificationsCopy;
  return (
    <Link href="/notifications" aria-label={copy.badge(count)} className="inline-flex min-h-11 items-center gap-1.5 text-fg underline-offset-4 hover:underline">
      {copy.badgeShort}
      {count > 0 ? (
        <span aria-hidden className="type-small rounded-full bg-accent px-2 font-semibold text-accent-ink">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
