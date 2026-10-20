import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
// Realtime delivery goes through the local Supabase stack; allow it a little longer.
const LIVE_TIMEOUT = { timeout: 20_000 };

test.describe('notifications (P4-T07)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('the badge counts unread notifications live, the center lists them, and settings save', async ({ page, context, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      await prepareMember(member, { verifiedDaysAgo: null });
      await withAppDatabase(async (sql) => {
        await sql`insert into notifications (user_id, kind, data) values
          (${member.userId}, 'chat_request', ${sql.json({ login: 'sam' })}),
          (${member.userId}, 'verified_by_vouches', '{}')`;
      });

      await page.goto('/notifications');
      await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByRole('link', { name: 'Notifications, 2 unread' })).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByText('@sam sent you a message request.')).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      // A new notification raises the badge without a reload.
      await withAppDatabase((sql) => sql`insert into notifications (user_id, kind, data) values (${member.userId}, 'chat_request_accepted', ${sql.json({ login: 'kim' })})`);
      await expect(page.getByRole('link', { name: 'Notifications, 3 unread' })).toBeVisible(LIVE_TIMEOUT);

      await page.getByRole('button', { name: 'Mark all as read' }).click();
      await expect(page.getByText('All caught up.')).toBeVisible(ACTION_TIMEOUT);
      await page.getByRole('link', { name: 'Notification settings' }).click();
      await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible(ACTION_TIMEOUT);

      await page.getByLabel('Email me a daily summary of unread notifications').check();
      await page.getByLabel('Mute: New message requests').check();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Saved.')).toBeVisible(ACTION_TIMEOUT);
      await expectNoSeriousA11yViolations(page);
      const [prefs] = await withAppDatabase((sql) => sql`select email_digest, kinds_muted from notification_prefs where user_id = ${member.userId}`);
      expect(prefs).toMatchObject({ email_digest: true, kinds_muted: ['chat_request'] });
    } finally {
      await member.cleanup();
    }
  });
});
