'use client';

import { Button, Card, Input } from '@commitmates/ui';
import { useActionState, useState } from 'react';

import { onboardingCopy } from '@/copy/onboarding';

import { RequestUniversity } from './RequestUniversity';
import type { ActionResult } from '@/server/action';
import { confirmCodeAction, startVerificationAction, type StartResult } from '@/server/actions/verification';

export type VerifyEmailProps = {
  /** An open verification from an earlier visit: the member goes straight to the code. */
  pending: { email: string; universityName: string } | null;
  /** For "Request my university" when the domain is unknown. */
  countries: readonly { code: string; name: string }[];
};

const fieldError = (result: ActionResult<unknown> | null, name: string) =>
  result && !result.ok && result.error.field === name ? result.error.message : undefined;

/** The email-then-code verification steps (CLAUDE.md §8 F10 steps 2–4). */
export function VerifyEmail({ pending, countries }: VerifyEmailProps) {
  const [startResult, startAction, starting] = useActionState(startVerificationAction, null);
  const [confirmResult, confirmAction, confirming] = useActionState(confirmCodeAction, null);
  const [email, setEmail] = useState(pending?.email ?? '');
  const [editing, setEditing] = useState(false);
  const [universityId, setUniversityId] = useState('');
  const [seenResult, setSeenResult] = useState(startResult);
  // Leave the email step only once a new code is on its way; an error keeps it open.
  if (seenResult !== startResult) {
    setSeenResult(startResult);
    if (startResult?.ok && startResult.data.status === 'sent') setEditing(false);
    if (startResult?.ok && startResult.data.status === 'choose') setUniversityId(startResult.data.universities[0]?.id ?? '');
  }
  const copy = onboardingCopy;

  const started: StartResult | null = startResult?.ok ? startResult.data : null;
  const sentTo = started?.status === 'sent' ? started.universityName : (pending?.universityName ?? null);
  const onCodeStep = sentTo !== null && !editing && started?.status !== 'choose' && started?.status !== 'unknown';
  const startError = startResult && !startResult.ok && startResult.error.field === undefined ? startResult.error.message : undefined;

  if (onCodeStep) {
    return (
      <Card title={copy.code.title} className="flex flex-col gap-4">
        <p className="type-body" role="status">
          {started?.status === 'sent' ? copy.code.sent(sentTo) : copy.code.pendingSent(sentTo)}
        </p>
        <form action={confirmAction} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Input
            className="flex-1"
            name="code"
            label={copy.code.label}
            error={fieldError(confirmResult, 'code') ?? fieldError(confirmResult, 'email')}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
          />
          <Button type="submit" variant="primary" size="md" loading={confirming} className="sm:mt-[26px]">
            {copy.code.submit}
          </Button>
        </form>
        {confirmResult && !confirmResult.ok && confirmResult.error.field === undefined ? (
          <p role="alert" className="type-small text-state-error">
            {confirmResult.error.message}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <form action={startAction}>
            <input type="hidden" name="email" value={email} />
            <Button type="submit" variant="secondary" size="sm" loading={starting}>
              {copy.code.resend}
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(true);
            }}
          >
            {copy.code.other}
          </Button>
        </div>
        {startError ? (
          <p role="alert" className="type-small text-state-error">
            {startError}
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card title={copy.email.title} className="flex flex-col gap-4">
      <form action={startAction} className="flex flex-col gap-4">
        <Input
          name="email"
          type="email"
          label={copy.email.label}
          description={copy.email.description}
          error={fieldError(startResult, 'email')}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          autoComplete="email"
          required
        />
        {started?.status === 'choose' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="type-small mb-1 font-semibold">{copy.choose.legend}</legend>
            {started.universities.map((university) => (
              <label key={university.id} className="type-body flex min-h-11 items-center gap-2">
                {/* Controlled, so React's form reset after the previous submit cannot undo the choice. */}
                <input
                  type="radio"
                  name="universityId"
                  value={university.id}
                  checked={universityId === university.id}
                  onChange={() => {
                    setUniversityId(university.id);
                  }}
                  className="size-4 accent-accent"
                />
                {university.name}
              </label>
            ))}
          </fieldset>
        ) : null}
        {started?.status === 'unknown' ? (
          <p role="status" className="type-small text-fg-muted">
            {copy.unknown(started.domain)}
          </p>
        ) : null}
        {startError ? (
          <p role="alert" className="type-small text-state-error">
            {startError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="md" loading={starting} className="self-start">
          {started?.status === 'choose' ? copy.choose.submit : copy.email.submit}
        </Button>
      </form>
      {started?.status === 'unknown' ? <RequestUniversity key={started.domain} domain={started.domain} countries={countries} /> : null}
    </Card>
  );
}
