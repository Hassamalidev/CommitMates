'use client';

import type { GapFacet, GapHelpers, GapResult } from '@commitmates/core';
import { Button, Card, Dialog, Skeleton, Textarea } from '@commitmates/ui';
import { useActionState, useEffect, useMemo, useState } from 'react';

import { gapCopy } from '@/copy/gap';
import type { ActionResult } from '@/server/action';
import { askGapHelperAction, gapHelpersAction } from '@/server/actions/gap';

/** The skill tag a gap stands for: a dependency tag, or the topic a path matches; repository properties have none. */
export function gapTag(gap: Pick<GapFacet, 'kind' | 'name' | 'topic'>): string | null {
  if (gap.kind === 'tag') return gap.name;
  if (gap.kind === 'path') return gap.topic;
  return null;
}

type Props = { result: GapResult; campusMinMembers: number; signedIn: boolean; label: (gap: GapResult['gaps'][number]) => string };

function AskDialog({ helper, repo, tag, label }: { helper: { userId: string; login: string }; repo: string; tag: string; label: string }) {
  const copy = gapCopy.campus.ask;
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [result, action, pending] = useActionState(async (previous: ActionResult<null> | null, formData: FormData) => {
    const outcome = await askGapHelperAction(previous, formData);
    if (outcome.ok) {
      setSent(true);
      setOpen(false);
    }
    return outcome;
  }, null);
  const error = result && !result.ok ? result.error : null;
  if (sent) {
    return (
      <p role="status" className="type-small text-state-done">
        {copy.sent(helper.login)}
      </p>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="secondary" size="sm">
          {copy.trigger(helper.login)}
        </Button>
      }
      title={copy.title(helper.login)}
      description={copy.description}
      closeLabel={copy.close}
    >
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="toUserId" value={helper.userId} />
        <input type="hidden" name="repoFullName" value={repo} />
        <input type="hidden" name="tag" value={tag} />
        <Textarea label={copy.message} name="message" rows={4} required defaultValue={copy.prefill(repo, label)} error={error?.field === 'message' ? error.message : undefined} />
        {error && error.field !== 'message' ? (
          <p role="alert" className="type-small text-state-error">
            {error.message}
          </p>
        ) : null}
        <Button type="submit" variant="primary" loading={pending} className="self-start">
          {copy.submit}
        </Button>
      </form>
    </Dialog>
  );
}

/**
 * "Who at your uni can help" (CLAUDE.md §8 F5 step 7): for signed-in members, classmates whose code
 * shows a gap's skill, each with an Ask button; otherwise what it takes to see them.
 */
export function GapCampusPanel({ result, campusMinMembers, signedIn, label }: Props) {
  const copy = gapCopy.campus;
  const tagged = useMemo(() => result.gaps.flatMap((gap) => {
    const tag = gapTag(gap);
    return tag ? [{ gap, tag }] : [];
  }), [result.gaps]);
  const [state, setState] = useState<GapHelpers | 'loading' | 'failed'>('loading');

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    const isActive = () => active;
    gapHelpersAction(tagged.map((entry) => entry.tag))
      .then((outcome) => {
        if (isActive()) setState(outcome.ok ? outcome.data : 'failed');
      })
      .catch(() => {
        if (isActive()) setState('failed');
      });
    return () => {
      active = false;
    };
  }, [signedIn, tagged]);

  const body = (() => {
    if (!signedIn) return <p className="type-body text-fg-muted">{copy.line(campusMinMembers)}</p>;
    if (state === 'loading') return <Skeleton className="h-16 w-full" aria-label={copy.loading} />;
    if (state === 'failed') return <p className="type-body text-fg-muted">{copy.failed}</p>;
    if (state.state === 'unverified') return <p className="type-body text-fg-muted">{copy.verify}</p>;
    if (state.state === 'locked') return <p className="type-body text-fg-muted">{copy.locked(state.current, state.required)}</p>;
    const helpers = state.helpers;
    const any = tagged.some((entry) => (helpers[entry.tag] ?? []).length > 0);
    if (!any) return <p className="type-body text-fg-muted">{copy.none}</p>;
    return (
      <>
        <p className="type-small text-fg-muted">{copy.intro}</p>
        <ul className="flex flex-col gap-4">
          {tagged.map(({ gap, tag }) => {
            const people = helpers[tag] ?? [];
            return (
              <li key={gap.facet} className="flex flex-col gap-2">
                <h3 className="type-h3">{copy.forGap(label(gap))}</h3>
                {people.length === 0 ? (
                  <p className="type-small text-fg-muted">{copy.nobodyFor}</p>
                ) : (
                  <ul className="flex flex-wrap gap-3">
                    {people.map((helper) => (
                      <li key={helper.userId} className="flex items-center gap-2">
                        <AskDialog helper={helper} repo={result.repo.fullName} tag={tag} label={label(gap)} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </>
    );
  })();

  return (
    <Card title={copy.title} className="flex flex-col gap-3">
      {body}
    </Card>
  );
}
