'use client';

import { Button, Input, StateChip, Textarea } from '@commitmates/ui';
import { useActionState, useState } from 'react';

import { adminCopy } from '@/copy/admin';
import { formatUtc } from '@/lib/format';
import { loadReportContextAction, moderateAction, type ContextLine } from '@/server/actions/moderation';

export type ReportGroupView = {
  targetUserId: string;
  login: string;
  name: string | null;
  status: 'active' | 'suspended' | 'hidden_pending_review';
  universityName: string | null;
  isAdmin: boolean;
  reports: { id: string; reason: string; details: string | null; reporterLogin: string | null; hasMessage: boolean; createdAt: string }[];
};

const STATUS_STATE = { active: 'done', suspended: 'error', hidden_pending_review: 'waiting' } as const;
const ACTIONS = Object.keys(adminCopy.moderation.actions) as (keyof typeof adminCopy.moderation.actions)[];

/** The conversation around a reported message, loaded only when the moderator asks for it. */
function ReportContext({ reportId }: { reportId: string }) {
  const copy = adminCopy.moderation;
  const [lines, setLines] = useState<ContextLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (lines) {
    return (
      <section aria-label={copy.contextTitle} className="mt-2 rounded-control border border-line bg-surface-2 p-3">
        <p className="type-small text-fg-muted">{copy.contextNote}</p>
        {lines.length === 0 ? (
          <p className="type-small mt-2">{copy.contextEmpty}</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1">
            {lines.map((line) => (
              <li key={line.id} className="type-small break-words">
                <span className="font-semibold">{line.kind === 'system' ? copy.systemMessage : `@${line.authorLogin ?? '?'}`}</span>
                {line.reported ? ` (${copy.reportedMessage})` : ''}: {line.deleted ? copy.deletedMessage : line.body}
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }
  return (
    <div className="mt-1">
      <Button
        size="sm"
        variant="ghost"
        loading={loading}
        onClick={() => {
          setLoading(true);
          void loadReportContextAction(reportId).then((result) => {
            setLoading(false);
            if (result.ok) setLines(result.data);
            else setError(result.error.message);
          });
        }}
      >
        {copy.showContext}
      </Button>
      {error ? (
        <p role="alert" className="type-small text-state-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Open reports about one member and the decision form (CLAUDE.md §8 F12 "Moderation queue").
 * The reported message's context is fetched on request, because reading it is audited.
 */
export function ReportGroupCard({ group, maxDays, canActOnAdmins }: { group: ReportGroupView; maxDays: number; canActOnAdmins: boolean }) {
  const copy = adminCopy.moderation;
  const [result, action, pending] = useActionState(moderateAction, null);
  const [choice, setChoice] = useState<(typeof ACTIONS)[number]>('dismiss');
  const name = group.name ?? `@${group.login}`;
  const locked = group.isAdmin && !canActOnAdmins;
  return (
    <article aria-label={name} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-h3 break-words">{copy.member(name, group.universityName)}</h2>
        <StateChip state={STATUS_STATE[group.status]} label={copy.statusLabel[group.status]} />
      </header>
      <p className="type-small text-fg-muted">{copy.reports(group.reports.length)}</p>
      <ul className="flex flex-col gap-3">
        {group.reports.map((report) => (
          <li key={report.id} className="border-l-2 border-line pl-3">
            <p className="type-small">
              {copy.reportLine(copy.reasons[report.reason] ?? report.reason, report.reporterLogin)} ·{' '}
              <time dateTime={report.createdAt}>{formatUtc(new Date(report.createdAt))}</time>
            </p>
            {report.details ? <p className="type-body break-words whitespace-pre-wrap">{report.details}</p> : null}
            {report.hasMessage ? <ReportContext reportId={report.id} /> : null}
          </li>
        ))}
      </ul>
      {locked ? (
        <p className="type-small text-fg-muted">{copy.adminOnly}</p>
      ) : (
        <form action={action} className="flex flex-col gap-3 border-t border-line pt-3">
          <input type="hidden" name="targetUserId" value={group.targetUserId} />
          <fieldset className="flex flex-col gap-1">
            <legend className="type-small mb-1 font-semibold">{copy.actionLegend(group.login)}</legend>
            {ACTIONS.map((key) => (
              <label key={key} className="type-small flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="action"
                  value={key}
                  checked={choice === key}
                  onChange={() => {
                    setChoice(key);
                  }}
                />
                {copy.actions[key]}
              </label>
            ))}
          </fieldset>
          {choice === 'suspend' ? (
            <Input
              label={copy.days}
              name="days"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxDays}
              required
              description={copy.daysHelp(maxDays)}
              error={result && !result.ok && result.error.field === 'days' ? result.error.message : undefined}
            />
          ) : null}
          <Textarea label={copy.note} name="note" rows={2} maxLength={500} description={copy.noteHelp} />
          {result && !result.ok && result.error.field !== 'days' ? (
            <p role="alert" className="type-small text-state-error">
              {result.error.message}
            </p>
          ) : null}
          {result?.ok ? (
            <p role="status" className="type-small text-state-done">
              {copy.done}
            </p>
          ) : null}
          <Button type="submit" variant={choice === 'ban' || choice === 'suspend' ? 'danger' : 'primary'} loading={pending} className="self-start">
            {copy.submit}
          </Button>
        </form>
      )}
    </article>
  );
}
