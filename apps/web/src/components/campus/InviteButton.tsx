'use client';

import { Button } from '@commitmates/ui';
import { useState } from 'react';

import { campusCopy } from '@/copy/campus';

/**
 * Copies the member's invite link (CLAUDE.md §1.4: `?ref=<uni-slug>`). The link is also shown as
 * text, so it can be copied by hand where the clipboard is unavailable.
 */
export function InviteButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = campusCopy.invite;
  return (
    <div className="flex flex-col gap-2">
      <label className="type-small font-semibold" htmlFor="invite-link">
        {copy.label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="invite-link"
          readOnly
          value={link}
          className="type-code min-h-11 min-w-0 flex-1 rounded-control border border-line bg-surface-2 px-3"
          onFocus={(event) => {
            event.target.select();
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => {
            // Without clipboard access the link stays selectable in the field above.
            navigator.clipboard.writeText(link).then(
              () => {
                setCopied(true);
              },
              () => undefined,
            );
          }}
        >
          {copied ? copy.copied : copy.button}
        </Button>
      </div>
    </div>
  );
}
