'use client';

import { Button, Card, Input, Textarea } from '@commitmates/ui';
import { useEffect, useState, type SubmitEvent } from 'react';

import { JobStatus } from '@/components/tools/JobStatus';
import { parseSkills, recruiterCopy } from '@/copy/recruiter';
import type { JobState } from '@/lib/job-state';
import { parseRecruiter } from '@/lib/recruiter';
import { useJob } from '@/lib/use-job';
import { loadOwnSecretScan } from '@/server/actions/recruiter';

import { RecruiterView } from './RecruiterView';
import { SecretPanel } from './SecretPanel';

export type RecruiterToolProps = {
  initialLogin?: string | undefined;
  /** The signed-in member's login: their own check may include the secret scan. */
  memberLogin?: string | undefined;
};

const IDLE: JobState<unknown> = { phase: 'idle' };

const loginKey = (login: string | undefined) => login?.replace(/^@/, '').toLowerCase();
const sameLogin = (a: string | undefined, b: string | undefined) => {
  const left = loginKey(a);
  return left !== undefined && left !== '' && left === loginKey(b);
};

/** The Recruiter-Ready Score: a username (and optional claimed skills) in, a checklist out. */
export function RecruiterTool({ initialLogin, memberLogin }: RecruiterToolProps) {
  const { state, start } = useJob('recruiter', parseRecruiter);
  const [login, setLogin] = useState(initialLogin ?? memberLogin ?? '');
  const [skills, setSkills] = useState('');
  const [scan, setScan] = useState(true);
  const isOwn = sameLogin(login.trim(), memberLogin);

  useEffect(() => {
    if (initialLogin) start({ login: initialLogin, ...(sameLogin(initialLogin, memberLogin) ? { scanSecrets: true } : {}) });
  }, [initialLogin, memberLogin, start]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = login.trim();
    const resumeSkills = parseSkills(skills);
    start({
      login: value,
      ...(resumeSkills.length > 0 ? { resumeSkills } : {}),
      ...(isOwn && scan ? { scanSecrets: true } : {}),
    });
    window.history.replaceState(null, '', value ? `?login=${encodeURIComponent(value)}` : window.location.pathname);
  };

  const busy = state.phase === 'working' || state.phase === 'waiting';
  const fieldError = (field: string) => (state.phase === 'error' && state.field === field ? state.message : undefined);
  const hasFieldError = state.phase === 'error' && state.field !== undefined;
  const result = state.phase === 'done' ? state.result : null;
  const { form } = recruiterCopy;

  return (
    <div className="flex flex-col gap-6">
      <Card title={form.title} className="flex flex-col gap-6">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Input
            name="login"
            label={form.label}
            error={fieldError('login')}
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
          <Textarea
            name="skills"
            label={form.skillsLabel}
            description={form.skillsDescription}
            error={fieldError('resumeSkills')}
            value={skills}
            onChange={(event) => {
              setSkills(event.target.value);
            }}
            rows={2}
          />
          {isOwn ? (
            <label className="type-body flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                name="scanSecrets"
                checked={scan}
                onChange={(event) => {
                  setScan(event.target.checked);
                }}
                className="mt-1 size-5 accent-accent"
                aria-describedby="scan-description"
              />
              <span>
                {form.scanLabel}
                <span id="scan-description" className="type-small block text-fg-muted">
                  {form.scanDescription}
                </span>
              </span>
            </label>
          ) : null}
          <Button type="submit" variant="primary" size="md" loading={busy} className="self-start">
            {result ? form.again : form.submit}
          </Button>
        </form>
        <JobStatus state={hasFieldError ? IDLE : state} steps={recruiterCopy.steps} idleLine={recruiterCopy.idleLine} />
      </Card>
      {result ? <RecruiterView result={result} /> : null}
      {result?.secretScanRan && sameLogin(result.login, memberLogin) ? <SecretPanel load={loadOwnSecretScan} /> : null}
    </div>
  );
}
