import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
/** Participants `unlock.squads.minParticipants` asks for by default. */
const UNLOCK_PARTICIPANTS = 6;

test.describe('Squad Builder (P6-T06)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('an organizer forms teams, a participant switches once, and the final team gets a conversation', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const title = `Hack Night ${suffix}`;
    const universityId = await seedUniversity(`Squad University ${suffix}`, `squad-university-${suffix}`);
    const organizer = await signInTestMember(context, baseURL ?? '');
    const participantContext = await browser.newContext();
    const participant = await signInTestMember(participantContext, baseURL ?? '');
    process.env.LOG_LEVEL = 'warn';
    const core = await import('@commitmates/core');
    const db = await import('@commitmates/db');
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try {
      await prepareMember(organizer, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(participant, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await withAppDatabase(
        (sql) => sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                     values (${participant.userId}, '{}', ${sql.json({ react: 1 })}, '{react}', '{}', now())`,
      );

      await page.goto('/home');
      await page.getByRole('link', { name: 'See events' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Find a team for your next hackathon' })).toBeVisible(ACTION_TIMEOUT);
      await page.getByLabel('Event name').fill(title);
      await page.getByLabel('First day').fill(tomorrow);
      await page.getByLabel('Last day').fill(tomorrow);
      await page.getByLabel('People per team').fill('3');
      await page.getByRole('button', { name: 'Create event' }).click();
      await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, ACTION_TIMEOUT);
      const eventId = page.url().split('/').pop() ?? '';
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByText(`0 / ${UNLOCK_PARTICIPANTS} participants`)).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      // Classmates who already joined, with skills that make two roles.
      await withAppDatabase(async (sql) => {
        for (const tag of ['react', 'postgresql', 'postgresql', 'react', 'postgresql']) {
          const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
          await sql`insert into users (id) values (${auth!.id}) on conflict (id) do nothing`;
          await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at)
                    values (${auth!.id}, 'UTC', ${universityId}, now(), 'email', now())`;
          await sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                    values (${auth!.id}, '{}', ${sql.json({ [tag]: 1 })}, ${[tag]}, '{}', now())`;
          await sql`insert into event_participants (event_id, user_id) values (${eventId}, ${auth!.id})`;
        }
      });

      const theirs = await participantContext.newPage();
      await theirs.goto('/events');
      await theirs.getByRole('link', { name: title }).click();
      await theirs.getByLabel('Monday: from', { exact: true }).selectOption('9');
      await theirs.getByLabel('Monday: until', { exact: true }).selectOption('17');
      await theirs.getByRole('button', { name: 'Join event' }).click();
      // Once joined, the page shows the joined state: save free time, leave, and groups.
      await expect(theirs.getByRole('button', { name: 'Leave event' })).toBeVisible(ACTION_TIMEOUT);
      await theirs.getByRole('button', { name: 'Start a group' }).click();
      await expect(theirs.getByText(/^Your group code is [0-9a-f]{8} \(1 person\)/)).toBeVisible(ACTION_TIMEOUT);
      await expectNoSeriousA11yViolations(theirs);

      await page.reload();
      await page.getByRole('button', { name: 'Form teams' }).click();
      await expect(page.getByText('Forming teams. Reload in a moment to see them.')).toBeVisible(ACTION_TIMEOUT);
      // The formation job runs here.
      expect((await core.buildSquads(eventId, 1))?.teams).toBe(2);
      await page.reload();
      await expect(page.getByRole('article', { name: 'Team 1' })).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByRole('article', { name: 'Team 2' })).toBeVisible();

      await theirs.reload();
      const mine = theirs.getByRole('article').filter({ hasText: 'Your team' });
      await expect(mine.getByText(`@${participant.login}`)).toBeVisible(ACTION_TIMEOUT);
      await theirs.getByRole('button', { name: /^Ask to switch to team \d$/ }).click();
      await expect(theirs.getByText('Your switch request is waiting for the organizer.')).toBeVisible(ACTION_TIMEOUT);

      await page.reload();
      await expect(page.getByText(new RegExp(`@${participant.login} wants to join team \\d`))).toBeVisible(ACTION_TIMEOUT);
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page.getByText('No switch requests waiting.')).toBeVisible(ACTION_TIMEOUT);
      await page.reload();
      await page.getByRole('button', { name: 'Finalize teams' }).click();
      await expect(page.getByText('Teams are final.').first()).toBeVisible(ACTION_TIMEOUT);

      await theirs.reload();
      await expect(theirs.getByText('You were moved to the team you asked for.')).toBeVisible(ACTION_TIMEOUT);
      await theirs.getByRole('link', { name: 'Open your team conversation' }).click();
      await expect(theirs.getByRole('log', { name: 'Messages' }).getByText(new RegExp(`^Your team for ${title}: .*@${participant.login}`))).toBeVisible(ACTION_TIMEOUT);
    } finally {
      await db.closeDb();
      await participantContext.close();
      await organizer.cleanup();
      await participant.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
