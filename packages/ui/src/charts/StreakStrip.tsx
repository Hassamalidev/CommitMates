import { VisuallyHidden } from '../components/VisuallyHidden';
import { cn } from '../lib/cn';

export type StreakDayOutcome = 'counted' | 'frozen' | 'missed';
export type StreakStripDay = { day: string; outcome: StreakDayOutcome | null };

export type StreakStripProps = {
  /** Consecutive days, oldest first; `null` for a day not judged (before the pair, skipped or paused). */
  days: readonly StreakStripDay[];
  /** Name of the chart, e.g. "The last 30 days". */
  label: string;
  /** Words for each outcome, used in the legend and the screen-reader list. */
  outcomeLabels: Readonly<Record<StreakDayOutcome | 'none', string>>;
  /** One day in words for the screen-reader list, e.g. "Oct 14: counted". */
  describeDay: (day: StreakStripDay) => string;
  className?: string;
};

// Outcomes are told apart by shape as well as color, so the strip reads without color vision.
const cellClass: Record<StreakDayOutcome | 'none', string> = {
  counted: 'bg-state-done',
  frozen: 'bg-state-waiting rounded-full',
  missed: 'border-2 border-state-error bg-transparent',
  none: 'bg-surface-2',
};

/** A pair's recent days, one cell each (CLAUDE.md §8 F13 "UI": a 30-day strip), with a legend. */
export function StreakStrip({ days, label, outcomeLabels, describeDay, className }: StreakStripProps) {
  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <figcaption className="type-small text-fg-muted">{label}</figcaption>
      <div aria-hidden className="flex flex-wrap gap-1">
        {days.map((day) => (
          <span key={day.day} className={cn('size-3 shrink-0 rounded-[2px]', cellClass[day.outcome ?? 'none'])} />
        ))}
      </div>
      <ul aria-hidden className="type-small flex flex-wrap gap-x-3 gap-y-1 text-fg-muted">
        {(['counted', 'frozen', 'missed', 'none'] as const).map((outcome) => (
          <li key={outcome} className="inline-flex items-center gap-1">
            <span className={cn('size-3 rounded-[2px]', cellClass[outcome])} />
            {outcomeLabels[outcome]}
          </li>
        ))}
      </ul>
      <VisuallyHidden>
        <ul>
          {days.map((day) => (
            <li key={day.day}>{describeDay(day)}</li>
          ))}
        </ul>
      </VisuallyHidden>
    </figure>
  );
}
