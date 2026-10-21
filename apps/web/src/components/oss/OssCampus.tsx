'use client';

import type { OssCampus } from '@commitmates/core';
import { useEffect, useState } from 'react';

import { AskDialog } from '@/components/chat/AskDialog';
import { ossCopy } from '@/copy/oss';
import { askOssContributorAction, ossCampusAction } from '@/server/actions/oss';

type Contributors = Extract<OssCampus, { state: 'open' }>['contributors'];

/**
 * Loads, once per result, the members of the viewer's university who contributed to its projects
 * (CLAUDE.md §8 F8 step 5). Visitors and unverified members get nothing, so nothing is asked.
 */
export function useOssCampus(repos: readonly string[], signedIn: boolean): Contributors | null {
  const [contributors, setContributors] = useState<Contributors | null>(null);
  const key = repos.join('\n');
  useEffect(() => {
    if (!signedIn || key === '') return;
    let active = true;
    const isActive = () => active;
    ossCampusAction(key.split('\n'))
      .then((outcome) => {
        if (isActive() && outcome.ok && outcome.data.state === 'open') setContributors(outcome.data.contributors);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [key, signedIn]);
  return contributors;
}

/** "N members of your university contributed here", with an Ask button for each. */
export function OssCampusLine({ repo, people }: { repo: string; people: Contributors[string] | undefined }) {
  if (!people || people.length === 0) return null;
  const copy = ossCopy.campus;
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line p-3">
      <p className="type-small font-semibold">{copy.contributed(people.length)}</p>
      <ul className="flex flex-col gap-2">
        {people.map((person) => (
          <li key={person.userId} className="flex flex-wrap items-center gap-3">
            <span className="type-small">{copy.merged(person.login, person.mergedPrs)}</span>
            <AskDialog
              login={person.login}
              title={copy.askTitle(person.login)}
              values={{ toUserId: person.userId, repo }}
              prefill={copy.prefill(repo)}
              action={askOssContributorAction}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
