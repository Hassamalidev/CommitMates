'use client';

import { Button, Input, Select } from '@commitmates/ui';
import { useActionState } from 'react';

import { onboardingCopy } from '@/copy/onboarding';
import { requestUniversityAction } from '@/server/actions/universities';

export type RequestUniversityProps = {
  domain: string;
  /** Countries from the university list; nothing is hand-listed. */
  countries: readonly { code: string; name: string }[];
};

/** "Request my university" for a domain the list does not have (CLAUDE.md §8 F10 step 2). */
export function RequestUniversity({ domain, countries }: RequestUniversityProps) {
  const [result, action, pending] = useActionState(requestUniversityAction, null);
  const copy = onboardingCopy.request;
  const error = (name: string) => (result && !result.ok && result.error.field === name ? result.error.message : undefined);

  if (result?.ok) {
    return (
      <p role="status" className="type-body">
        {copy.sent}
      </p>
    );
  }

  return (
    <section aria-labelledby="request-university" className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 id="request-university" className="type-h3">
        {copy.title}
      </h3>
      <p className="type-small text-fg-muted">{copy.line}</p>
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="domain" value={domain} />
        <Input name="proposedName" label={copy.name} error={error('proposedName') ?? error('domain')} maxLength={200} required />
        <Select
          name="countryCode"
          label={copy.country}
          placeholder={copy.countryPlaceholder}
          error={error('countryCode')}
          options={countries.map((country) => ({ value: country.code, label: country.name }))}
          defaultValue=""
          required
        />
        {result && result.error.field === undefined ? (
          <p role="alert" className="type-small text-state-error">
            {result.error.message}
          </p>
        ) : null}
        <Button type="submit" variant="secondary" size="md" loading={pending} className="self-start">
          {copy.submit}
        </Button>
      </form>
    </section>
  );
}
