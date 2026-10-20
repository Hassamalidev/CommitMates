import { MATCH_MODES, type MatchMode } from '@commitmates/algorithms';
import type { DiscoverView } from '@commitmates/core';
import { Button, Input, Select, buttonStyles, cn } from '@commitmates/ui';
import Link from 'next/link';

import { discoverCopy } from '@/copy/discover';
import { discoverHref } from '@/lib/discover';

type OpenView = Extract<DiscoverView, { status: 'open' }>;

/** The filters as address parameters, so switching mode keeps them. */
export function filterParams(filters: OpenView['filters']) {
  return { department: filters.departmentId, from: filters.yearFrom, to: filters.yearTo, tag: filters.tag };
}

/** Mode switch as links (CLAUDE.md §8 F11 "UI"): each mode has its own address and deck. */
export function ModeTabs({ mode, filters }: { mode: MatchMode; filters: OpenView['filters'] }) {
  const copy = discoverCopy;
  return (
    <nav aria-label={copy.modesLabel}>
      <ul className="flex gap-1 overflow-x-auto border-b border-line">
        {MATCH_MODES.map((key) => (
          <li key={key} className="shrink-0">
            <Link
              href={discoverHref(key, filterParams(filters))}
              aria-current={key === mode ? 'page' : undefined}
              className={cn(
                'type-small inline-flex min-h-11 items-center border-b-2 px-4 font-semibold transition-colors duration-150',
                key === mode ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {copy.modes[key].label}
            </Link>
          </li>
        ))}
      </ul>
      <p className="type-small mt-2 text-fg-muted">{copy.modes[mode].line}</p>
    </nav>
  );
}

/** Department, graduation years and skill (§8 F11 "UI"); a plain GET form, so it works without JavaScript. */
export function DeckFilters({ view }: { view: OpenView }) {
  const copy = discoverCopy.filters;
  const { filters, options } = view;
  const active = Object.values(filterParams(filters)).some((value) => value !== undefined);
  return (
    <section aria-labelledby="filters-title" className="rounded-card border border-line bg-surface p-4">
      <h2 id="filters-title" className="type-h3">
        {copy.title}
      </h2>
      <form method="get" action="/discover" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="mode" value={view.mode} />
        <Select
          label={copy.department}
          name="department"
          defaultValue={filters.departmentId ?? ''}
          options={[{ value: '', label: copy.anyDepartment }, ...options.departments.map((department) => ({ value: department.id, label: department.name }))]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label={copy.yearFrom} name="from" type="number" inputMode="numeric" min={options.years.min} max={options.years.max} defaultValue={filters.yearFrom ?? ''} />
          <Input label={copy.yearTo} name="to" type="number" inputMode="numeric" min={options.years.min} max={options.years.max} defaultValue={filters.yearTo ?? ''} />
        </div>
        <Select
          label={copy.tag}
          name="tag"
          defaultValue={filters.tag ?? ''}
          options={[{ value: '', label: copy.anyTag }, ...options.tags.map((tag) => ({ value: tag, label: tag }))]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" size="sm">
            {copy.apply}
          </Button>
          {active ? (
            <Link href={discoverHref(view.mode)} className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
              {copy.clear}
            </Link>
          ) : null}
        </div>
      </form>
    </section>
  );
}
