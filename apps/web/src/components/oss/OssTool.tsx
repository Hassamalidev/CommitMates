'use client';

import type { OssResult } from '@commitmates/core';
import { Button, Card, Chip, Input } from '@commitmates/ui';
import { useEffect, useState, type SubmitEvent } from 'react';

import { JobStatus } from '@/components/tools/JobStatus';
import { ossCopy } from '@/copy/oss';
import type { JobState } from '@/lib/job-state';
import { useJob } from '@/lib/use-job';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A structural check of a result that reached the browser; the server validated the full schema. */
export function parseOss(value: unknown): OssResult | null {
  if (!isRecord(value) || !Array.isArray(value.issues) || !Array.isArray(value.languages) || !Array.isArray(value.relaxed)) return null;
  return value.issues.every((issue) => isRecord(issue) && typeof issue.url === 'string' && typeof issue.title === 'string') ? (value as OssResult) : null;
}

/** Splits a comma-separated list. */
export const splitList = (text: string) => [...new Set(text.split(',').map((value) => value.trim()).filter((value) => value !== ''))];

export type OssToolProps = {
  initialLogin?: string | undefined;
  /** Language names from Linguist, offered as suggestions. */
  languageOptions: readonly string[];
};

const IDLE: JobState<unknown> = { phase: 'idle' };

/** The Open-Source Starter (CLAUDE.md §8 F8 "UI"): what you know in, friendly first issues out. */
export function OssTool({ initialLogin, languageOptions }: OssToolProps) {
  const { state, start } = useJob('oss', parseOss);
  const [login, setLogin] = useState(initialLogin ?? '');
  const [languages, setLanguages] = useState('');
  const [topics, setTopics] = useState('');
  const { form, result: copy } = ossCopy;

  useEffect(() => {
    if (initialLogin) start({ login: initialLogin });
  }, [initialLogin, start]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const picked = splitList(languages);
    const liked = splitList(topics);
    start({
      ...(login.trim() ? { login: login.trim() } : {}),
      ...(picked.length > 0 ? { languages: picked } : {}),
      ...(liked.length > 0 ? { topics: liked } : {}),
    });
  };

  const busy = state.phase === 'working' || state.phase === 'waiting';
  const fieldError = (field: string) => (state.phase === 'error' && state.field === field ? state.message : undefined);
  const hasFieldError = state.phase === 'error' && state.field !== undefined;
  const result = state.phase === 'done' ? state.result : null;

  return (
    <div className="flex flex-col gap-6">
      <Card title={form.title} className="flex flex-col gap-6">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Input
            name="login"
            label={form.loginLabel}
            description={form.loginDescription}
            error={fieldError('login')}
            value={login}
            onChange={(event) => {
              setLogin(event.target.value);
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={40}
          />
          <Input
            name="languages"
            label={form.languagesLabel}
            description={form.languagesDescription}
            error={fieldError('languages')}
            value={languages}
            onChange={(event) => {
              setLanguages(event.target.value);
            }}
            list="oss-languages"
            autoComplete="off"
          />
          <datalist id="oss-languages">
            {languageOptions.map((language) => (
              <option key={language} value={language} />
            ))}
          </datalist>
          <Input
            name="topics"
            label={form.topicsLabel}
            description={form.topicsDescription}
            error={fieldError('topics')}
            value={topics}
            onChange={(event) => {
              setTopics(event.target.value);
            }}
            autoComplete="off"
          />
          <Button type="submit" variant="primary" size="md" loading={busy} className="self-start">
            {form.submit}
          </Button>
        </form>
        <JobStatus state={hasFieldError ? IDLE : state} steps={ossCopy.steps} idleLine={ossCopy.idleLine} />
      </Card>

      {result ? (
        <section aria-labelledby="oss-results" data-testid="oss-result" className="flex flex-col gap-4">
          <div>
            <h2 id="oss-results" className="type-h2">
              {copy.title(result.issues.length)}
            </h2>
            {result.languages.length > 0 ? <p className="type-small mt-1 text-fg-muted">{copy.searched(result.languages.join(', '))}</p> : null}
            {result.relaxed.map((gate) => (
              <p key={gate} className="type-small mt-1 text-fg-muted">
                {copy.relaxed[gate]}
              </p>
            ))}
          </div>
          {result.issues.length === 0 ? (
            <Card>
              <p className="type-body">{copy.none}</p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {result.issues.map((issue) => (
                <li key={issue.url}>
                  <Card as="article" aria-label={issue.title} className="flex flex-col gap-2">
                    <h3 className="type-h3">
                      <a href={issue.url} rel="noreferrer" className="text-accent underline underline-offset-4">
                        {issue.title}
                      </a>
                    </h3>
                    <p className="type-small text-fg-muted">
                      {issue.repo} · {copy.age(issue.ageDays)} · {copy.comments(issue.comments)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {issue.labels.map((label) => (
                        <Chip key={label}>{label}</Chip>
                      ))}
                      <Chip>{issue.responseHours === null ? copy.replyUnknown : copy.reply(issue.responseHours)}</Chip>
                      {issue.skillMatch > 0 ? <Chip>{copy.match(issue.skillMatch)}</Chip> : null}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
