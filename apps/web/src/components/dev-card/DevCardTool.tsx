'use client';

import { Button, Card, CompanionView, EmptyState, Input } from '@commitmates/ui';
import { useEffect, useState, type SubmitEvent } from 'react';

import { JobStatus } from '@/components/tools/JobStatus';
import { devCardCopy } from '@/copy/dev-card';
import { toolsCopy } from '@/copy/tools';
import { brandCompanion } from '@/lib/brand';
import { parseDevCard } from '@/lib/dev-card';
import type { JobState } from '@/lib/job-state';
import { useJob } from '@/lib/use-job';

import { DevCardView } from './DevCardView';

export type DevCardToolProps = {
  /** Prefills the input and builds this card right away, e.g. from `?login=`. */
  initialLogin?: string | undefined;
  /** A member's profile page: the login is fixed and there is no form. */
  fixed?: boolean;
};

const IDLE: JobState<unknown> = { phase: 'idle' };

/** The Dev Card tool: a username in, the companion reporting progress, the card out. */
export function DevCardTool({ initialLogin, fixed = false }: DevCardToolProps) {
  const { state, start } = useJob('dev-card', parseDevCard);
  const [login, setLogin] = useState(initialLogin ?? '');

  useEffect(() => {
    if (initialLogin) start({ login: initialLogin });
  }, [initialLogin, start]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = login.trim();
    start({ login: value });
    // The address then names the card, so it can be reloaded or bookmarked.
    window.history.replaceState(null, '', value ? `?login=${encodeURIComponent(value)}` : window.location.pathname);
  };

  const busy = state.phase === 'working' || state.phase === 'waiting';
  const fieldError = state.phase === 'error' && state.field === 'login' ? state.message : undefined;
  const card = state.phase === 'done' ? state.result : null;

  return (
    <div className="flex flex-col gap-6">
      <Card {...(fixed ? {} : { title: devCardCopy.form.title })} className="flex flex-col gap-6">
        {fixed ? null : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Input
              className="flex-1"
              name="login"
              label={devCardCopy.form.label}
              description={devCardCopy.form.description}
              error={fieldError}
              value={login}
              onChange={(event) => {
                setLogin(event.target.value);
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={40}
              required
            />
            <Button type="submit" variant="primary" size="md" loading={busy} className="sm:mt-[26px]">
              {card ? devCardCopy.form.again : devCardCopy.form.submit}
            </Button>
          </form>
        )}
        {/* A field error is shown next to the field; the companion stays calm. */}
        <JobStatus state={fieldError ? IDLE : state} steps={devCardCopy.steps} idleLine={devCardCopy.idleLine} />
      </Card>

      {card ? (
        card.enoughActivity ? (
          <DevCardView card={card} />
        ) : (
          <EmptyState
            companion={
              <CompanionView companion={brandCompanion} state="idle" size={96} label={toolsCopy.job.companionLabel(toolsCopy.job.states.idle)} />
            }
            title={devCardCopy.notEnough.title}
            description={devCardCopy.notEnough.line}
          />
        )
      ) : null}
    </div>
  );
}
