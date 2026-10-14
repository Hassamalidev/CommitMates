import { VisuallyHidden } from '../components/VisuallyHidden';
import { cn } from '../lib/cn';

export type TimelineSeries = { key: string; label: string; values: readonly number[] };

export type TimelineProps = {
  /** One label per column, e.g. week starts. */
  columns: readonly string[];
  series: readonly TimelineSeries[];
  /** Caption of the screen-reader table. */
  label: string;
  /** Heading of the first column of that table. */
  seriesHeading: string;
  className?: string;
};

/** Faintest shade of a column with any activity, so it stays distinguishable from none. */
const MIN_OPACITY = 0.2;

/**
 * One row per series and one cell per column, shaded by value against the busiest cell of
 * the chart (CLAUDE.md §9.4). The first and last column labels anchor the axis; screen
 * readers get every value as a table.
 */
export function Timeline({ columns, series, label, seriesHeading, className }: TimelineProps) {
  const max = Math.max(0, ...series.flatMap((row) => row.values));
  const first = columns[0];
  const last = columns.at(-1);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div aria-hidden="true" className="flex flex-col gap-1.5 overflow-x-auto pb-1">
        {series.map((row) => (
          <div key={row.key} data-series={row.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3">
            <span className="type-small truncate text-fg">{row.label}</span>
            <div className="flex gap-px">
              {columns.map((column, index) => {
                const value = row.values[index] ?? 0;
                return (
                  <span key={column} className="h-4 min-w-1.5 flex-1 rounded-[2px] bg-surface-2">
                    {value > 0 && max > 0 ? (
                      <span
                        className="block size-full rounded-[2px] bg-accent"
                        style={{ opacity: MIN_OPACITY + (1 - MIN_OPACITY) * (value / max) }}
                      />
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        {first && last ? (
          <div className="type-small grid grid-cols-[minmax(6rem,10rem)_1fr] gap-3 text-fg-muted">
            <span />
            <span className="flex justify-between font-mono">
              <span>{first}</span>
              <span>{last}</span>
            </span>
          </div>
        ) : null}
      </div>
      <VisuallyHidden as="table">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{seriesHeading}</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {columns.map((column, index) => (
                <td key={column}>{row.values[index] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </VisuallyHidden>
    </div>
  );
}
