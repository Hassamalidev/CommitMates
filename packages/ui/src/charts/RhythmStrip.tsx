import { VisuallyHidden } from '../components/VisuallyHidden';
import { cn } from '../lib/cn';

import { formatSharePercent } from './LanguageBar';

export type RhythmStripProps = {
  /** 24 shares, one per local hour starting at midnight. */
  hours: readonly number[];
  /** Heading of the screen-reader list, e.g. "Most active hours". */
  label: string;
  /** How an hour is written, e.g. `(hour) => "14:00"`. */
  formatHour: (hour: number) => string;
  /** Shown instead of the list when there is no activity, e.g. "No activity in this window". */
  emptyLabel: string;
  className?: string;
};

const HOURS_PER_DAY = 24;
/** An axis label every this many hours (CLAUDE.md §9.4). */
const LABEL_EVERY_HOURS = 6;
/** Hours listed for screen readers. */
const TOP_HOURS = 3;
/** Faintest shade of an hour that has any activity, so it stays distinguishable from none. */
const MIN_OPACITY = 0.15;

/** The busiest hours, busiest first; hours without activity are left out. */
export function topHours(hours: readonly number[], limit: number = TOP_HOURS): { hour: number; share: number }[] {
  return hours
    .map((share, hour) => ({ hour, share }))
    .filter((entry) => entry.share > 0)
    .sort((a, b) => b.share - a.share || a.hour - b.hour)
    .slice(0, limit);
}

/**
 * Twenty-four cells, one per hour, shaded by the share of activity in that hour
 * (CLAUDE.md §9.4). Screen readers get the busiest hours as a list.
 */
export function RhythmStrip({ hours, label, formatHour, emptyLabel, className }: RhythmStripProps) {
  const cells = Array.from({ length: HOURS_PER_DAY }, (_, hour) => hours[hour] ?? 0);
  const max = Math.max(...cells);
  const top = topHours(cells);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div aria-hidden="true" className="grid grid-cols-24 gap-px">
        {cells.map((share, hour) => (
          <span key={hour} data-hour={hour} className="h-6 rounded-sm bg-surface-2">
            {share > 0 ? (
              <span
                className="block size-full rounded-sm bg-accent"
                style={{ opacity: MIN_OPACITY + (1 - MIN_OPACITY) * (share / max) }}
              />
            ) : null}
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="type-small grid grid-cols-24 text-fg-muted">
        {cells.map((_, hour) =>
          hour % LABEL_EVERY_HOURS === 0 ? (
            <span key={hour} className="col-span-6 font-mono">
              {formatHour(hour)}
            </span>
          ) : null,
        )}
      </div>
      <VisuallyHidden as="div">
        <p>{label}</p>
        {top.length === 0 ? (
          <p>{emptyLabel}</p>
        ) : (
          <ol>
            {top.map((entry) => (
              <li key={entry.hour}>
                {formatHour(entry.hour)}: {formatSharePercent(entry.share)}
              </li>
            ))}
          </ol>
        )}
      </VisuallyHidden>
    </div>
  );
}
