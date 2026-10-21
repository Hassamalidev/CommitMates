'use client';

import type { GapFacet, GapHelpers, GapResult } from '@commitmates/core';
import { Card, Skeleton } from '@commitmates/ui';
import { useEffect, useMemo, useState } from 'react';

import { AskDialog } from '@/components/chat/AskDialog';

import { gapCopy } from '@/copy/gap';
import { askGapHelperAction, gapHelpersAction } from '@/server/actions/gap';

/** The skill tag a gap stands for: a dependency tag, or the topic a path matches; repository properties have none. */
export function gapTag(gap: Pick<GapFacet, 'kind' | 'name' | 'topic'>): string | null {
  if (gap.kind === 'tag') return gap.name;
  if (gap.kind === 'path') return gap.topic;
  return null;
}

type Props = { result: GapResult; campusMinMembers: number; signedIn: boolean; label: (gap: GapResult['gaps'][number]) => string };

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
                        <AskDialog
                          login={helper.login}
                          title={copy.ask.title(helper.login)}
                          values={{ toUserId: helper.userId, repoFullName: result.repo.fullName, tag }}
                          prefill={copy.ask.prefill(result.repo.fullName, label(gap))}
                          action={askGapHelperAction}
                        />
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
