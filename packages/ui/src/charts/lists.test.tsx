import { findA11yViolations } from '@commitmates/config/testing/axe';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarList } from './BarList';
import { Timeline } from './Timeline';

describe('BarList', () => {
  const items = [
    { key: 'a', label: 'alice', value: 30, valueLabel: '60% · 30 commits' },
    { key: 'b', label: 'bob', value: 15, valueLabel: '30% · 15 commits' },
    { key: 'c', label: 'carol', value: 0, valueLabel: '0% · 0 commits' },
  ];
  const show = () => render(<BarList items={items} label="Share of commits" nameHeading="Person" valueHeading="Share" />);

  it('scales bars to the largest value', () => {
    const { container } = show();
    const widths = [...container.querySelectorAll<HTMLElement>('[data-key] .bg-accent')].map((bar) => bar.style.width);
    expect(widths).toEqual(['100%', '50%', '0%']);
  });

  it('gives screen readers a table', () => {
    show();
    const rows = within(screen.getByRole('table', { name: 'Share of commits' })).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual(['PersonShare', 'alice60% · 30 commits', 'bob30% · 15 commits', 'carol0% · 0 commits']);
  });

  it('copes with nothing to show and has no serious violations', async () => {
    const { container } = render(<BarList items={[{ key: 'x', label: 'x', value: 0, valueLabel: '0' }]} label="l" nameHeading="n" valueHeading="v" />);
    expect(container.querySelector<HTMLElement>('[data-key] .bg-accent')?.style.width).toBe('0%');
    expect(await findA11yViolations(show().container)).toEqual([]);
  });
});

describe('Timeline', () => {
  const columns = ['2026-09-06', '2026-09-13', '2026-09-20'];
  const series = [
    { key: 'a', label: 'alice', values: [4, 0, 2] },
    { key: 'b', label: 'bob', values: [0, 1] },
  ];
  const show = () => render(<Timeline columns={columns} series={series} label="Commits per week" seriesHeading="Person" />);

  it('shades cells by value against the busiest one and labels the ends of the axis', () => {
    const { container } = show();
    const rows = [...container.querySelectorAll<HTMLElement>('[data-series]')];
    const shades = rows.map((row) => [...row.querySelectorAll<HTMLElement>('.bg-accent')].map((cell) => Number(cell.style.opacity)));
    expect(shades[0]?.[0]).toBe(1);
    expect(shades[0]).toHaveLength(2);
    expect(shades[1]).toHaveLength(1);
    expect(container.textContent).toContain('2026-09-06');
    expect(container.textContent).toContain('2026-09-20');
  });

  it('lists every value for screen readers, treating missing ones as zero', async () => {
    const { container } = show();
    const rows = within(screen.getByRole('table', { name: 'Commits per week' })).getAllByRole('row');
    expect(rows.at(-1)?.textContent).toBe('bob010');
    expect(await findA11yViolations(container)).toEqual([]);
  });
});
