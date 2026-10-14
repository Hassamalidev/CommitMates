import type { Unlock } from '@commitmates/core';
import { StateChip, UnlockCard } from '@commitmates/ui';
import type { ReactNode } from 'react';

import { campusCopy } from '@/copy/campus';

/** Every campus feature at a university: open, or an Unlock card with its progress (CLAUDE.md §1.4). */
export function UnlockList({ unlocks, action }: { unlocks: readonly Unlock[]; action?: ReactNode }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {unlocks.map((unlock) => {
        const text = campusCopy.unlocks[unlock.key];
        const label = campusCopy.progress[unlock.metric](unlock.current, unlock.required);
        return (
          <li key={unlock.key}>
            {unlock.unlocked ? (
              <section className="rounded-card border border-line bg-surface p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="type-h3">{text.title}</h3>
                  <StateChip state="done" label={campusCopy.unlocked} />
                </div>
                <p className="type-body mt-1 text-fg-muted">{text.line}</p>
              </section>
            ) : (
              <UnlockCard
                title={text.title}
                description={text.line}
                current={unlock.current}
                required={unlock.required}
                progressLabel={label}
                action={action}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
