// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sampleDevCard } from '@/__fixtures__/dev-card';
import { devCardCopy, isDevCardLabelKey } from '@/copy/dev-card';
import { companionFor, formatCalendarDate, formatHour, parseDevCard } from '@/lib/dev-card';

import { DevCardTool } from './DevCardTool';
import { DevCardView } from './DevCardView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('parseDevCard', () => {
  it('accepts a stored card and rejects other shapes', () => {
    expect(parseDevCard(sampleDevCard)).toBe(sampleDevCard);
    for (const bad of [
      null,
      'card',
      {},
      { ...sampleDevCard, login: 7 },
      { ...sampleDevCard, hourHist: [1, 2, 3] },
      { ...sampleDevCard, hourHist: new Array<string>(24).fill('x') },
      { ...sampleDevCard, languages: null },
      { ...sampleDevCard, metrics: {} },
      { ...sampleDevCard, companion: { seed: 1 } },
    ]) {
      expect(parseDevCard(bad)).toBeNull();
    }
  });
});

describe('companionFor', () => {
  it('derives a drawable companion, deterministically', () => {
    const companion = companionFor(sampleDevCard);
    expect(companion).toEqual(companionFor(sampleDevCard));
    expect(companion).toMatchObject({ seed: 4242, paletteHex: '#3178c6', stage: 2, traits: [] });
    expect(Number.isInteger(companion.species)).toBe(true);
    expect(companionFor({ companion: { ...sampleDevCard.companion, speciesKey: 'React' } }).species).toBe(companion.species);
  });

  it('falls back to the site palette and keeps the stage in range', () => {
    const companion = companionFor({ companion: { ...sampleDevCard.companion, paletteHex: null, stage: 99 } });
    expect(companion.paletteHex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(companion.stage).toBe(4);
    expect(companionFor({ companion: { ...sampleDevCard.companion, stage: -3 } }).stage).toBe(0);
  });
});

describe('formatting', () => {
  it('writes hours and calendar dates the way the card shows them', () => {
    expect(formatHour(9)).toBe('09:00');
    expect(formatHour(22)).toBe('22:00');
    expect(formatCalendarDate('2026-10-14')).toBe('Oct 14');
    expect(formatCalendarDate('nonsense')).toBe('nonsense');
  });
});

describe('devCardCopy', () => {
  it('has a name and evidence for every label and the steps the job reports', () => {
    for (const key of ['nightOwl', 'earlyBird', 'weekendWarrior', 'sprinter', 'marathoner', 'balanced']) {
      expect(isDevCardLabelKey(key), key).toBe(true);
    }
    expect(isDevCardLabelKey('unknown')).toBe(false);
    expect(devCardCopy.labels.nightOwl.evidence(sampleDevCard.metrics)).toBe('75% of activity between 22:00 and 04:00.');
    expect(devCardCopy.labels.marathoner.evidence(sampleDevCard.metrics)).toBe('Active on 45 of the last 90 days.');
    expect(devCardCopy.steps.map((step) => step.key)).toEqual(['finding', 'repos', 'activity', 'building']);
    expect(devCardCopy.card.day('Oct 14', 1)).toBe('Oct 14: 1 contribution');
    expect(devCardCopy.card.stats.days(1)).toBe('1 day');
  });
});

describe('DevCardView', () => {
  it('shows the companion, labels with evidence, languages, rhythm, calendar, numbers and skills', () => {
    render(<DevCardView card={sampleDevCard} />);
    const card = screen.getByRole('article', { name: "Fixture User's Dev Card" });
    expect(within(card).getByRole('img', { name: 'The companion of @fixture-user-1' })).toBeTruthy();
    expect(within(card).getByRole('link', { name: '@fixture-user-1 on GitHub' }).getAttribute('href')).toBe(
      'https://github.com/fixture-user-1',
    );

    expect(within(card).getByText('Night Owl')).toBeTruthy();
    expect(within(card).getByText('75% of activity between 22:00 and 04:00.')).toBeTruthy();
    expect(within(card).getByText('Marathoner')).toBeTruthy();

    expect(within(card).getByRole('table', { name: 'Languages by share of code' })).toBeTruthy();
    expect(within(card).getByRole('slider', { name: 'Contributions per day in the last 90 days' })).toBeTruthy();
    expect(within(card).getByText('6 days')).toBeTruthy();
    expect(within(card).getByText('45 days')).toBeTruthy();
    expect(within(card).getByText('1,234')).toBeTruthy();
    expect(within(card).getByText('react')).toBeTruthy();
    expect(within(card).getByText('discord-bot')).toBeTruthy();
  });

  it('says where the timezone came from and credits OpenStreetMap for a geocoded one', () => {
    const { unmount } = render(<DevCardView card={sampleDevCard} />);
    expect(screen.getByText(/Based on public activity in the last 90 days\./).textContent).toContain(
      'Hours are in Asia/Karachi, from the location on the GitHub profile. © OpenStreetMap contributors',
    );
    unmount();

    render(<DevCardView card={{ ...sampleDevCard, timezone: 'UTC', timezoneSource: 'utc' }} />);
    const note = screen.getByText(/Based on public activity/).textContent;
    expect(note).toContain('hours are in UTC');
    expect(note).not.toContain('OpenStreetMap');
  });

  it('explains what is missing instead of showing empty charts', () => {
    render(
      <DevCardView
        card={{
          ...sampleDevCard,
          name: null,
          labels: [],
          languages: [],
          tags: [],
          reposTruncated: true,
          reposAnalyzed: 100,
          metrics: { ...sampleDevCard.metrics, privateIncluded: true },
        }}
      />,
    );
    expect(screen.getByRole('article', { name: "@fixture-user-1's Dev Card" })).toBeTruthy();
    expect(screen.getByText('Too little recent public activity to describe a rhythm yet.')).toBeTruthy();
    expect(screen.getByText('No code in public repositories yet.')).toBeTruthy();
    expect(screen.getByText(/No skill tags yet/)).toBeTruthy();
    expect(screen.getByText('Based on the 100 most recently pushed repositories.')).toBeTruthy();
    expect(screen.getByText(/Includes private contribution counts/)).toBeTruthy();
  });

  it('ignores a label it has no words for', () => {
    render(<DevCardView card={{ ...sampleDevCard, labels: [{ key: 'futureLabel', strength: 1 }] }} />);
    expect(screen.queryByText('futureLabel')).toBeNull();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = render(<DevCardView card={sampleDevCard} />);
    expect(await findA11yViolations(container)).toEqual([]);
  });
});

describe('DevCardTool', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const reply = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/tools/dev-card');
  });

  it('rests until a username is submitted, then shows the card and names it in the address', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: sampleDevCard }));
    render(<DevCardTool />);
    expect(screen.getByText(devCardCopy.idleLine)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('GitHub username'), { target: { value: ' fixture-user-1 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build card' }));

    await waitFor(() => {
      expect(screen.getByTestId('dev-card')).toBeTruthy();
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"login":"fixture-user-1"}');
    expect(window.location.search).toBe('?login=fixture-user-1');
    expect(screen.getByRole('button', { name: 'Build another' })).toBeTruthy();
    // Nothing on a visitor's result offers to share it.
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /share/i })).toBeNull();
  });

  it('builds the card for the login in the address right away', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: sampleDevCard }));
    render(<DevCardTool initialLogin="fixture-user-1" />);
    expect(screen.getByLabelText<HTMLInputElement>('GitHub username').value).toBe('fixture-user-1');
    await waitFor(() => {
      expect(screen.getByTestId('dev-card')).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('has no form on a member profile', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: sampleDevCard }));
    render(<DevCardTool initialLogin="fixture-user-1" fixed />);
    expect(screen.queryByLabelText('GitHub username')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('dev-card')).toBeTruthy();
    });
  });

  it('shows a validation error next to the field and keeps the companion calm', async () => {
    fetchMock.mockReturnValueOnce(
      reply({ status: 'error', error: { code: 'tool.invalid_input', message: 'That does not look like a GitHub username.', field: 'login' } }, 400),
    );
    render(<DevCardTool />);
    fireEvent.change(screen.getByLabelText('GitHub username'), { target: { value: 'not a login' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build card' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('That does not look like a GitHub username.');
    });
    expect(screen.getByLabelText('GitHub username').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'The companion is idle' })).toBeTruthy();
  });

  it('shows job errors through the companion', async () => {
    fetchMock.mockReturnValueOnce(
      reply({ status: 'error', error: { code: 'rate.limited', message: "You're going a bit fast. Try again in about 30 seconds." } }, 429),
    );
    render(<DevCardTool initialLogin="someone" />);
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'The companion is showing an error' })).toBeTruthy();
    });
    expect(screen.getByRole('alert').textContent).toContain('going a bit fast');
  });

  it('explains an account with too little activity instead of drawing an empty card', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: { ...sampleDevCard, enoughActivity: false, labels: [] } }));
    render(<DevCardTool initialLogin="quiet-account" />);
    await waitFor(() => {
      expect(screen.getByText('Not much to show yet')).toBeTruthy();
    });
    expect(screen.getByText(devCardCopy.notEnough.line)).toBeTruthy();
    expect(screen.queryByTestId('dev-card')).toBeNull();
  });
});
