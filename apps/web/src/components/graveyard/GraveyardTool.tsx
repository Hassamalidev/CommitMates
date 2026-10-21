'use client';

import { Button, Card, Input, Select, Tabs, buttonStyles } from '@commitmates/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';

import { JobStatus } from '@/components/tools/JobStatus';
import { graveyardCopy } from '@/copy/graveyard';
import { filterItems, parseGraveyard, type DifficultyFilter, type LicenseFilter } from '@/lib/graveyard';
import type { JobState } from '@/lib/job-state';
import { useJob } from '@/lib/use-job';

import { GraveyardCard } from './GraveyardCard';

export type GraveyardScope = 'global' | 'uni';
/** Who is looking: the uni tab needs a verified member (CLAUDE.md §8 F7 "Tier"). */
export type GraveyardViewer = 'visitor' | 'member' | 'verified';

export type GraveyardToolProps = { initialQuery?: string | undefined; initialScope?: GraveyardScope; viewer?: GraveyardViewer };

const IDLE: JobState<unknown> = { phase: 'idle' };

/** The Project Graveyard: a topic in, inactive projects worth reviving out (CLAUDE.md §8 F7 "UI"). */
export function GraveyardTool({ initialQuery, initialScope = 'global', viewer = 'visitor' }: GraveyardToolProps) {
  const { state, start } = useJob('graveyard', parseGraveyard);
  const verified = viewer === 'verified';
  const [tab, setTab] = useState<GraveyardScope | 'country'>(initialScope);
  // Radix reports a click as both mousedown and focus before React re-renders; the ref drops the repeat.
  const currentTab = useRef(tab);
  const scope: GraveyardScope = tab === 'uni' && verified ? 'uni' : 'global';
  const [query, setQuery] = useState(initialQuery ?? '');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('any');
  const [license, setLicense] = useState<LicenseFilter>('any');
  const copy = graveyardCopy;

  useEffect(() => {
    if (initialQuery) start({ q: initialQuery, scope: initialScope === 'uni' && !verified ? 'global' : initialScope });
  }, [initialQuery, initialScope, verified, start]);

  const address = (q: string, where: GraveyardScope) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (where !== 'global') params.set('scope', where);
    const search = params.toString();
    window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
  };
  const search = (value: string, where: GraveyardScope = scope) => {
    setQuery(value);
    start({ q: value.trim(), scope: where });
    address(value.trim(), where);
  };
  const switchTab = (value: string) => {
    if ((value !== 'global' && value !== 'uni' && value !== 'country') || value === currentTab.current) return;
    currentTab.current = value;
    setTab(value);
    if (value === 'country') return;
    // The same topic, searched where the member just looked.
    if (query.trim() && (value === 'global' || verified)) search(query, value);
    else address(query.trim(), value);
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    search(query);
  };

  const busy = state.phase === 'working' || state.phase === 'waiting';
  const fieldError = state.phase === 'error' && state.field === 'q' ? state.message : undefined;
  // A result from the other tab stays with its tab.
  const result = state.phase === 'done' && state.result.scope === scope ? state.result : null;
  const shown = result ? filterItems(result.items, difficulty, license) : [];

  const searchPanel = (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-6">
        {scope === 'uni' ? (
          <p className="type-small text-fg-muted">
            {copy.scopes.uniIntro}{' '}
            <Link href="/settings/projects" className="text-accent underline underline-offset-4">
              {copy.scopes.uniOwn}
            </Link>
          </p>
        ) : null}
        <form onSubmit={submit} noValidate role="search" className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Input
            className="flex-1"
            name="q"
            type="search"
            label={copy.form.label}
            description={copy.form.description}
            error={fieldError}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            maxLength={100}
            required
          />
          <Button type="submit" variant="primary" size="md" loading={busy} className="sm:mt-[26px]">
            {copy.form.submit}
          </Button>
        </form>
        <JobStatus state={fieldError ? IDLE : state} steps={copy.steps} idleLine={copy.idleLine} />
      </Card>

      {result ? (
        <section aria-labelledby="graveyard-results" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="graveyard-results" className="type-h2">
                {copy.result.count(shown.length, result.items.length)}
              </h2>
              {result.terms.length > 0 ? <p className="type-small mt-1 text-fg-muted">{copy.result.widened(result.terms.join(', '))}</p> : null}
            </div>
            {result.items.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                <Select
                  label={copy.filters.difficulty}
                  className="w-48"
                  value={difficulty}
                  onChange={(event) => {
                    setDifficulty(event.target.value as DifficultyFilter);
                  }}
                  options={[
                    { value: 'any', label: copy.filters.any },
                    ...Object.entries(copy.difficulty).map(([value, label]) => ({ value, label })),
                  ]}
                />
                <Select
                  label={copy.filters.license}
                  className="w-44"
                  value={license}
                  onChange={(event) => {
                    setLicense(event.target.value as LicenseFilter);
                  }}
                  options={[
                    { value: 'any', label: copy.filters.any },
                    { value: 'licensed', label: copy.filters.licensed },
                    { value: 'unlicensed', label: copy.filters.unlicensed },
                  ]}
                />
              </div>
            ) : null}
          </div>
          {result.items.length === 0 ? (
            <Card>
              <p className="type-body">{copy.result.none}</p>
              {result.suggestions.length > 0 ? (
                <p className="type-small mt-2 flex flex-wrap items-center gap-2 text-fg-muted">
                  {copy.result.tryInstead}
                  {result.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        search(suggestion.replace(/-/g, ' '));
                      }}
                      className="min-h-11 text-accent underline underline-offset-4 sm:min-h-0"
                    >
                      {suggestion}
                    </button>
                  ))}
                </p>
              ) : null}
            </Card>
          ) : shown.length === 0 ? (
            <p className="type-body text-fg-muted">{copy.result.filteredOut}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {shown.map((item) => (
                <li key={item.fullName}>
                  <GraveyardCard item={item} verified={verified} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );

  const locked = (text: { title: string; line: string }, action?: { href: string; label: string }) => (
    <Card title={text.title} className="flex flex-col gap-3">
      <p className="type-body text-fg-muted">{text.line}</p>
      {action ? (
        <Link href={action.href} className={buttonStyles({ variant: 'primary', size: 'sm', className: 'self-start' })}>
          {action.label}
        </Link>
      ) : null}
    </Card>
  );
  const uniPanel = verified
    ? searchPanel
    : viewer === 'member'
      ? locked(copy.scopes.uniVerify, { href: '/onboarding', label: copy.scopes.uniVerify.action })
      : locked(copy.scopes.uniSignIn, { href: `/auth/sign-in?next=${encodeURIComponent('/tools/graveyard?scope=uni')}`, label: copy.scopes.uniSignIn.action });

  return (
    <Tabs
      label={copy.scopes.label}
      value={tab}
      onValueChange={switchTab}
      items={[
        { value: 'global', label: copy.scopes.global, content: tab === 'global' ? searchPanel : null },
        { value: 'uni', label: copy.scopes.uni, content: tab === 'uni' ? uniPanel : null },
        { value: 'country', label: copy.scopes.country, content: locked(copy.scopes.countryLocked) },
      ]}
    />
  );
}
