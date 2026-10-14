import { findA11yViolations } from '@commitmates/config/testing/axe';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Heatmap, heatLevel, weekdayRow } from './Heatmap';
import { LanguageBar, formatSharePercent } from './LanguageBar';
import { RhythmStrip, topHours } from './RhythmStrip';

describe('formatSharePercent', () => {
  it('rounds to whole percent and keeps slivers visible', () => {
    expect(formatSharePercent(0.424)).toBe('42%');
    expect(formatSharePercent(1)).toBe('100%');
    expect(formatSharePercent(0.004)).toBe('<1%');
    expect(formatSharePercent(0)).toBe('0%');
  });
});

describe('LanguageBar', () => {
  const languages = [
    { name: 'TypeScript', share: 0.6, color: '#3178c6' },
    { name: 'Python', share: 0.3, color: '#3572A5' },
    { name: 'other', share: 0.1, color: null },
    { name: 'Empty', share: 0, color: '#000000' },
  ];
  const show = () =>
    render(<LanguageBar languages={languages} label="Languages by share of code" nameHeading="Language" shareHeading="Share" />);

  it('sizes each segment by share and colors it from the data', () => {
    const { container } = show();
    const segments = [...container.querySelectorAll<HTMLElement>('[data-language]')];
    expect(segments.map((segment) => segment.dataset.language)).toEqual(['TypeScript', 'Python', 'other']);
    expect(segments.map((segment) => segment.style.width)).toEqual(['60%', '30%', '10%']);
    expect(segments[0]?.style.backgroundColor).toBe('rgb(49, 120, 198)');
    // No color in the data: a neutral token instead of an invented one.
    expect(segments[2]?.style.backgroundColor).toBe('');
    expect(segments[2]?.className).toContain('bg-fg-muted');
  });

  it('gives screen readers the same numbers as a table', () => {
    show();
    const table = screen.getByRole('table', { name: 'Languages by share of code' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual(['LanguageShare', 'TypeScript60%', 'Python30%', 'other10%']);
  });

  it('renders nothing without code', () => {
    const { container } = render(<LanguageBar languages={[]} label="x" nameHeading="a" shareHeading="b" />);
    expect(container.innerHTML).toBe('');
  });

  it('has no serious accessibility violations', async () => {
    const { container } = show();
    expect(await findA11yViolations(container)).toEqual([]);
  });
});

describe('topHours', () => {
  it('lists the busiest hours first and skips empty ones', () => {
    const hours = new Array<number>(24).fill(0);
    hours[23] = 0.5;
    hours[9] = 0.3;
    hours[2] = 0.1;
    hours[14] = 0.1;
    expect(topHours(hours)).toEqual([
      { hour: 23, share: 0.5 },
      { hour: 9, share: 0.3 },
      { hour: 2, share: 0.1 },
    ]);
    expect(topHours(new Array<number>(24).fill(0))).toEqual([]);
  });
});

describe('RhythmStrip', () => {
  const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
  const hours = new Array<number>(24).fill(0);
  hours[22] = 0.75;
  hours[9] = 0.25;
  const show = (values: readonly number[] = hours) =>
    render(<RhythmStrip hours={values} label="Most active hours" formatHour={formatHour} emptyLabel="No activity in this window" />);

  it('draws 24 cells, shading only the hours with activity', () => {
    const { container } = show();
    const cells = [...container.querySelectorAll<HTMLElement>('[data-hour]')];
    expect(cells).toHaveLength(24);
    const shaded = cells.filter((cell) => cell.firstElementChild !== null);
    expect(shaded.map((cell) => cell.dataset.hour)).toEqual(['9', '22']);
    // The busiest hour is fully opaque; the other is fainter but visible.
    expect((cells[22]?.firstElementChild as HTMLElement).style.opacity).toBe('1');
    const fainter = Number((cells[9]?.firstElementChild as HTMLElement).style.opacity);
    expect(fainter).toBeGreaterThan(0.15);
    expect(fainter).toBeLessThan(1);
  });

  it('labels the axis every six hours', () => {
    const { container } = show();
    expect(container.textContent).toContain('00:00');
    for (const label of ['06:00', '12:00', '18:00']) expect(container.textContent).toContain(label);
    expect(container.textContent).not.toContain('03:00');
  });

  it('lists the busiest hours for screen readers', () => {
    show();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['22:00: 75%', '09:00: 25%']);
  });

  it('says so when there is no activity, and tolerates a short array', () => {
    const { container, unmount } = show(new Array<number>(24).fill(0));
    expect(container.textContent).toContain('No activity in this window');
    unmount();
    expect(show([1]).container.querySelectorAll('[data-hour]')).toHaveLength(24);
  });

  it('has no serious accessibility violations', async () => {
    const { container } = show();
    expect(await findA11yViolations(container)).toEqual([]);
  });
});

describe('heatLevel and weekdayRow', () => {
  it('shades by quarter of the busiest day', () => {
    expect(heatLevel(0, 8)).toBe(0);
    expect(heatLevel(1, 8)).toBe(1);
    expect(heatLevel(2, 8)).toBe(1);
    expect(heatLevel(3, 8)).toBe(2);
    expect(heatLevel(6, 8)).toBe(3);
    expect(heatLevel(8, 8)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
    expect(heatLevel(Number.NaN, 8)).toBe(0);
  });

  it('puts Sunday in the first row', () => {
    expect(weekdayRow('2026-10-11')).toBe(0);
    expect(weekdayRow('2026-10-14')).toBe(3);
  });
});

describe('Heatmap', () => {
  // Wednesday 2026-10-07 to Wednesday 2026-10-14.
  const days = [0, 1, 0, 4, 0, 0, 2, 8].map((count, index) => ({ date: `2026-10-${String(7 + index).padStart(2, '0')}`, count }));
  const describeDay = (day: { date: string; count: number }) => `${day.date}: ${day.count} contributions`;
  const show = () =>
    render(
      <Heatmap
        days={days}
        label="Contributions in the last 90 days"
        describeDay={describeDay}
        hint="Use the arrow keys to read a day"
        dateHeading="Date"
        countHeading="Contributions"
      />,
    );
  const cell = (container: HTMLElement, date: string) => {
    const found = container.querySelector<HTMLElement>(`[data-date="${date}"]`);
    if (!found) throw new Error(`no cell for ${date}`);
    return found;
  };

  it('pads the first week so each day sits in its weekday row, and shades by count', () => {
    const { container } = show();
    const grid = screen.getByRole('slider', { name: 'Contributions in the last 90 days' });
    // Three empty cells (Sun, Mon, Tue) before the first Wednesday.
    expect(grid.children).toHaveLength(3 + days.length);
    expect(cell(container, '2026-10-07').dataset.level).toBe('0');
    expect(cell(container, '2026-10-08').dataset.level).toBe('1');
    expect(cell(container, '2026-10-10').dataset.level).toBe('2');
    expect(cell(container, '2026-10-14').dataset.level).toBe('4');
  });

  it('describes a day on hover and returns to the hint when the pointer leaves', () => {
    const { container } = show();
    expect(screen.getByText('Use the arrow keys to read a day')).toBeTruthy();
    fireEvent.mouseEnter(cell(container, '2026-10-10'));
    expect(screen.getByText('2026-10-10: 4 contributions')).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole('slider'));
    expect(screen.getByText('Use the arrow keys to read a day')).toBeTruthy();
  });

  it('is one tab stop that the arrow keys move through, starting at the latest day', () => {
    show();
    const grid = screen.getByRole('slider');
    expect(grid.tabIndex).toBe(0);

    expect(grid.getAttribute('aria-valuetext')).toBe('2026-10-14: 8 contributions');
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    expect(screen.getByText('2026-10-14: 8 contributions')).toBeTruthy();
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    expect(screen.getByText('2026-10-13: 2 contributions')).toBeTruthy();
    expect(grid.getAttribute('aria-valuetext')).toBe('2026-10-13: 2 contributions');
    expect(grid.getAttribute('aria-valuenow')).toBe('6');
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    // A week back does not exist from here, so it stops at the first day.
    expect(screen.getByText('2026-10-07: 0 contributions')).toBeTruthy();
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(screen.getByText('2026-10-14: 8 contributions')).toBeTruthy();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(screen.getByText('2026-10-14: 8 contributions')).toBeTruthy();

    fireEvent.keyDown(grid, { key: 'a' });
    expect(screen.getByText('2026-10-14: 8 contributions')).toBeTruthy();
    fireEvent.keyDown(grid, { key: 'Escape' });
    expect(screen.getByText('Use the arrow keys to read a day')).toBeTruthy();
  });

  it('highlights a tapped day and clears on blur', () => {
    const { container } = show();
    fireEvent.pointerDown(cell(container, '2026-10-08'));
    expect(screen.getByText('2026-10-08: 1 contributions')).toBeTruthy();
    fireEvent.blur(screen.getByRole('slider'));
    expect(screen.getByText('Use the arrow keys to read a day')).toBeTruthy();
  });

  it('gives screen readers every day as a table row', () => {
    show();
    const rows = within(screen.getByRole('table', { name: 'Contributions in the last 90 days' })).getAllByRole('row');
    expect(rows).toHaveLength(1 + days.length);
    expect(rows.at(-1)?.textContent).toBe('2026-10-148');
  });

  it('renders nothing without days', () => {
    const { container } = render(
      <Heatmap days={[]} label="x" describeDay={describeDay} hint="h" dateHeading="d" countHeading="c" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('has no serious accessibility violations', async () => {
    const { container } = show();
    expect(await findA11yViolations(container)).toEqual([]);
  });
});
