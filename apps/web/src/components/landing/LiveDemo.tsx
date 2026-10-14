'use client';

import { Button, CompanionView, EmptyState, Input, StateChip, TerminalWindow } from '@commitmates/ui';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState, type SubmitEvent } from 'react';

import { devCardCopy } from '@/copy/dev-card';
import { landingCopy } from '@/copy/landing';
import { toolsCopy } from '@/copy/tools';
import { brandCompanion } from '@/lib/brand';
import { demoLines } from '@/lib/demo-lines';
import { parseDevCard } from '@/lib/dev-card';
import { companionStateFor } from '@/lib/job-state';
import { useJob } from '@/lib/use-job';

// The card and its charts load only once a result arrives, keeping them off the landing page's first load.
const DevCardView = dynamic(() => import('@/components/dev-card/DevCardView').then((module) => module.DevCardView));

const chipLabel = {
  idle: toolsCopy.job.idleChip,
  working: toolsCopy.job.workingChip,
  waiting: toolsCopy.job.waitingChip,
  done: toolsCopy.job.doneChip,
  error: toolsCopy.job.errorChip,
} as const;

/**
 * The landing page's live demo (CLAUDE.md §9.6 step 2): a terminal that runs a real Dev
 * Card job, streams its steps as lines, a companion reacting beside it, and the card below.
 */
export function LiveDemo() {
  const { state, start } = useJob('dev-card', parseDevCard);
  const [login, setLogin] = useState('');
  const [ran, setRan] = useState<string | null>(null);
  const { demo } = landingCopy;

  // The waiting line's ETA is computed when the state changes; JobStatus refreshes it on the tool page.
  const lines = useMemo(() => demoLines(ran, state, devCardCopy.steps, new Date()), [ran, state]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = login.trim();
    setRan(value);
    start({ login: value });
  };

  const busy = state.phase === 'working' || state.phase === 'waiting';
  const fieldError = state.phase === 'error' && state.field === 'login' ? state.message : undefined;
  const card = state.phase === 'done' ? state.result : null;
  const companionState = companionStateFor(state.phase);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-6 md:grid-cols-[1fr_auto]">
        <TerminalWindow title={demo.terminalTitle} lines={lines} className="min-w-0">
          <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Input
              className="flex-1"
              name="login"
              label={demo.inputLabel}
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
              {card ? demo.runAgain : demo.run}
            </Button>
          </form>
        </TerminalWindow>
        <div className="flex items-center gap-3 md:flex-col">
          <CompanionView
            companion={brandCompanion}
            state={companionState}
            size={160}
            label={demo.companionLabel(toolsCopy.job.states[state.phase])}
          />
          <StateChip state={companionState} label={chipLabel[state.phase]} />
        </div>
      </div>

      {card ? (
        <div className="flex flex-col gap-3">
          {card.enoughActivity ? (
            <DevCardView card={card} />
          ) : (
            <EmptyState
              companion={
                <CompanionView companion={brandCompanion} state="idle" size={96} label={toolsCopy.job.companionLabel(toolsCopy.job.states.idle)} />
              }
              title={devCardCopy.notEnough.title}
              description={devCardCopy.notEnough.line}
            />
          )}
          <Link
            href={`/tools/dev-card?login=${encodeURIComponent(card.login)}`}
            className="type-body self-start text-accent underline underline-offset-4"
          >
            {demo.fullTool}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
