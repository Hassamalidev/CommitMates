import { VisuallyHidden } from '../components/VisuallyHidden';
import { cn } from '../lib/cn';

export type BarListItem = { key: string; label: string; value: number; /** Shown at the end of the bar, e.g. "42% · 120 commits". */ valueLabel: string };

export type BarListProps = {
  items: readonly BarListItem[];
  /** Caption of the screen-reader table. */
  label: string;
  nameHeading: string;
  valueHeading: string;
  className?: string;
};

/**
 * Horizontal bars, longest first as given, scaled to the largest value (CLAUDE.md §9.4).
 * Screen readers get the same numbers as a table.
 */
export function BarList({ items, label, nameHeading, valueHeading, className }: BarListProps) {
  const max = Math.max(0, ...items.map((item) => item.value));
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ul aria-hidden="true" className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key} data-key={item.key} className="flex flex-col gap-1">
            <div className="type-small flex items-baseline justify-between gap-3">
              <span className="truncate text-fg">{item.label}</span>
              <span className="shrink-0 font-mono text-fg-muted">{item.valueLabel}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${max === 0 ? 0 : (item.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <VisuallyHidden as="table">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{nameHeading}</th>
            <th scope="col">{valueHeading}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <th scope="row">{item.label}</th>
              <td>{item.valueLabel}</td>
            </tr>
          ))}
        </tbody>
      </VisuallyHidden>
    </div>
  );
}
