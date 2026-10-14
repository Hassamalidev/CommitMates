import type { ReactNode } from 'react';

export type Column<Row> = { header: string; cell: (row: Row) => ReactNode; numeric?: boolean };

export type DataTableProps<Row> = {
  /** Names the table for screen readers. */
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Shown instead of the table when there are no rows. */
  empty: string;
};

/** A dense table for admin pages (CLAUDE.md §9.6). Scrolls sideways on narrow screens. */
export function DataTable<Row>({ caption, columns, rows, rowKey, empty }: DataTableProps<Row>) {
  if (rows.length === 0) return <p className="type-small text-fg-muted">{empty}</p>;
  return (
    // A scrollable region must be reachable by keyboard.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="overflow-x-auto rounded-control border border-line" tabIndex={0} role="region" aria-label={caption}>
      <table className="type-small w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-surface-2 text-left">
            {columns.map((column) => (
              <th key={column.header} scope="col" className={`px-3 py-2 font-semibold ${column.numeric ? 'text-right' : ''}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-line align-top">
              {columns.map((column) => (
                <td key={column.header} className={`px-3 py-2 ${column.numeric ? 'text-right tabular-nums' : ''}`}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
