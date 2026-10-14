'use client';

import { Button, Card, Input } from '@commitmates/ui';
import { useActionState, useState, useSyncExternalStore, type ReactNode } from 'react';

import { onboardingCopy } from '@/copy/onboarding';
import { saveDetailsAction } from '@/server/actions/verification';

type Role = 'student' | 'alumni' | 'supervisor_pending';
type Visibility = 'university' | 'country' | 'public' | 'hidden';

export type OnboardingDetailsProps = {
  universityName: string;
  departments: readonly { id: string; name: string }[];
  suggestions: readonly string[];
  years: { min: number; max: number };
  maxGoals: number;
  /** Saved values when editing; defaults otherwise. */
  initial: {
    role: Role;
    gradYear: number | null;
    department: string;
    learningGoals: readonly string[];
    visibility: Visibility;
    shareTodayStatus: boolean;
    emailDigest: boolean;
    timezone: string;
  };
};

/** The timezone never changes while the page is open, so there is nothing to subscribe to. */
const neverChanges = () => () => undefined;
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Suggestions shown as quick-add buttons. */
const VISIBLE_SUGGESTIONS = 16;

function RadioGroup({ legend, name, options, value }: { legend: string; name: string; options: { value: string; label: string }[]; value: string }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="type-small mb-1 font-semibold">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="type-body flex min-h-11 items-center gap-2">
          <input type="radio" name={name} value={option.value} defaultChecked={option.value === value} className="size-4 accent-accent" />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

function Checkbox({ name, checked, children }: { name: string; checked: boolean; children: ReactNode }) {
  return (
    <label className="type-body flex min-h-11 items-center gap-2">
      <input type="checkbox" name={name} defaultChecked={checked} className="size-4 accent-accent" />
      {children}
    </label>
  );
}

/** The onboarding details (CLAUDE.md §8 F10 step 7), after verification and before home. */
export function OnboardingDetails({ universityName, departments, suggestions, years, maxGoals, initial }: OnboardingDetailsProps) {
  const [result, action, pending] = useActionState(saveDetailsAction, null);
  // Controlled, so React's reset after a submit with an error does not clear what was typed.
  const [goals, setGoals] = useState(initial.learningGoals.join(', '));
  const [gradYear, setGradYear] = useState(initial.gradYear === null ? '' : String(initial.gradYear));
  const [department, setDepartment] = useState(initial.department);
  // The browser knows the member's timezone (§6.10); the server renders the saved value.
  const timezone = useSyncExternalStore(neverChanges, browserTimezone, () => initial.timezone);
  const copy = onboardingCopy.details;
  const error = (name: string) => (result && !result.ok && result.error.field === name ? result.error.message : undefined);
  const chosen = new Set(goals.split(',').map((goal) => goal.trim().toLowerCase()).filter((goal) => goal !== ''));

  return (
    <Card title={copy.title} className="flex flex-col gap-4">
      <p className="type-body text-fg-muted">{copy.intro(universityName)}</p>
      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="timezone" value={timezone} />
        <RadioGroup
          legend={copy.role.legend}
          name="role"
          value={initial.role}
          options={[
            { value: 'student', label: copy.role.student },
            { value: 'alumni', label: copy.role.alumni },
            { value: 'supervisor_pending', label: copy.role.supervisor },
          ]}
        />
        <Input
          name="gradYear"
          type="number"
          label={copy.gradYear}
          description={copy.gradYearHelp(years.min, years.max)}
          error={error('gradYear')}
          min={years.min}
          max={years.max}
          value={gradYear}
          onChange={(event) => {
            setGradYear(event.target.value);
          }}
        />
        <Input
          name="department"
          label={copy.department}
          description={copy.departmentHelp}
          error={error('department')}
          list="department-options"
          value={department}
          onChange={(event) => {
            setDepartment(event.target.value);
          }}
          maxLength={120}
          autoComplete="off"
        />
        <datalist id="department-options">
          {departments.map((department) => (
            <option key={department.id} value={department.name} />
          ))}
        </datalist>
        <div className="flex flex-col gap-2">
          <Input
            name="learningGoals"
            label={copy.goals}
            description={copy.goalsHelp(maxGoals)}
            error={error('learningGoals')}
            value={goals}
            onChange={(event) => {
              setGoals(event.target.value);
            }}
            autoComplete="off"
          />
          {suggestions.length > 0 ? (
            <div role="group" aria-label={copy.goalsSuggestions} className="flex flex-wrap gap-2">
              {suggestions
                .filter((tag) => !chosen.has(tag))
                .slice(0, VISIBLE_SUGGESTIONS)
                .map((tag) => (
                  <Button
                    key={tag}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={copy.addGoal(tag)}
                    onClick={() => {
                      setGoals((current) => (current.trim() === '' ? tag : `${current.replace(/[,\s]*$/, '')}, ${tag}`));
                    }}
                  >
                    + {tag}
                  </Button>
                ))}
            </div>
          ) : null}
        </div>
        <RadioGroup
          legend={copy.visibility.legend}
          name="visibility"
          value={initial.visibility}
          options={[
            { value: 'university', label: copy.visibility.university },
            { value: 'country', label: copy.visibility.country },
            { value: 'public', label: copy.visibility.public },
            { value: 'hidden', label: copy.visibility.hidden },
          ]}
        />
        <div className="flex flex-col">
          <Checkbox name="shareTodayStatus" checked={initial.shareTodayStatus}>
            {copy.shareToday}
          </Checkbox>
          <Checkbox name="emailDigest" checked={initial.emailDigest}>
            {copy.emailDigest}
          </Checkbox>
        </div>
        {result && !result.ok && result.error.field === undefined ? (
          <p role="alert" className="type-small text-state-error">
            {result.error.message}
          </p>
        ) : null}
        {error('timezone') ? (
          <p role="alert" className="type-small text-state-error">
            {error('timezone')}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="md" loading={pending} className="self-start">
          {copy.submit}
        </Button>
      </form>
    </Card>
  );
}
