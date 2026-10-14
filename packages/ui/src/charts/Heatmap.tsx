'use client';

import { useState, type KeyboardEvent } from 'react';

import { VisuallyHidden } from '../components/VisuallyHidden';
import { cn } from '../lib/cn';

export type HeatmapDay = { date: string; count: number };

export type HeatmapProps = {
  /** Consecutive days in date order (`YYYY-MM-DD`). */
  days: readonly HeatmapDay[];
  /** Name of the chart, e.g. "Contributions in the last 90 days". */
  label: string;
  /** One day in words, e.g. "Oct 14: 2 contributions". Shown for the highlighted day and in the data table. */
  describeDay: (day: HeatmapDay) => string;
  /** Shown under the grid while no day is highlighted, e.g. "Hover or use the arrow keys to read a day". */
  hint: string;
  /** Column headings of the screen-reader table. */
  dateHeading: string;
  countHeading: string;
  className?: string;
};

const DAYS_PER_WEEK = 7;
/** Shades above "none"; a day's shade is its count relative to the busiest day. */
const LEVELS = 4;

const levelClass = ['bg-surface-2', 'bg-accent/25', 'bg-accent/50', 'bg-accent/75', 'bg-accent'] as const;

/** 0 for no contributions, otherwise 1–4 by quarter of the busiest day. */
export function heatLevel(count: number, max: number): number {
  if (!(count > 0) || !(max > 0)) return 0;
  return Math.min(LEVELS, Math.ceil((count / max) * LEVELS));
}

/** Row of a date in the grid: 0 = Sunday … 6 = Saturday. */
export const weekdayRow = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * A calendar grid with seven rows, one column per week, shaded by count (CLAUDE.md §9.4).
 * The grid is a single tab stop: hovering, tapping or the arrow keys highlight a day and
 * its description appears underneath and is announced. Screen readers also get a table.
 */
export function Heatmap({ days, label, describeDay, hint, dateHeading, countHeading, className }: HeatmapProps) {
  const [active, setActive] = useState<number | null>(null);
  if (days.length === 0) return null;

  const max = Math.max(...days.map((day) => day.count));
  const offset = weekdayRow(days[0]?.date ?? '');
  const activeDay = active === null ? undefined : days[active];
  // Until a day is highlighted the slider rests on the latest one.
  const shown = active ?? days.length - 1;
  const shownDay = days[shown];

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -DAYS_PER_WEEK, ArrowRight: DAYS_PER_WEEK }[event.key];
    if (step === undefined) {
      if (event.key === 'Escape') setActive(null);
      return;
    }
    event.preventDefault();
    setActive((current) => Math.min(days.length - 1, Math.max(0, (current ?? days.length - 1 - step) + step)));
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* One tab stop for the whole grid: a slider over the days, announced through its value text. */}
      <div
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={days.length - 1}
        aria-valuenow={shown}
        aria-valuetext={shownDay ? describeDay(shownDay) : undefined}
        tabIndex={0}
        onKeyDown={move}
        onBlur={() => {
          setActive(null);
        }}
        onMouseLeave={() => {
          setActive(null);
        }}
        className="grid w-fit grid-flow-col grid-rows-7 gap-0.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
      >
        {Array.from({ length: offset }, (_, index) => (
          <span key={`pad-${index}`} aria-hidden="true" className="size-3" />
        ))}
        {days.map((day, index) => (
          <span
            key={day.date}
            aria-hidden="true"
            data-date={day.date}
            data-level={heatLevel(day.count, max)}
            onMouseEnter={() => {
              setActive(index);
            }}
            onPointerDown={() => {
              setActive(index);
            }}
            className={cn(
              'size-3 rounded-[2px]',
              levelClass[heatLevel(day.count, max)],
              active === index && 'outline-2 outline-offset-1 outline-fg',
            )}
          />
        ))}
      </div>
      <p aria-hidden="true" className="type-small min-h-[22px] text-fg-muted">
        {activeDay ? describeDay(activeDay) : hint}
      </p>
      <VisuallyHidden as="table">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{dateHeading}</th>
            <th scope="col">{countHeading}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{day.count}</td>
            </tr>
          ))}
        </tbody>
      </VisuallyHidden>
    </div>
  );
}
