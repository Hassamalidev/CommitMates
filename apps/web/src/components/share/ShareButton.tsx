'use client';

import { Button } from '@commitmates/ui';
import { useState } from 'react';

import { shareCopy } from '@/copy/share';

export type ShareButtonProps = {
  /** Absolute URL of the page being shared. */
  url: string;
  title: string;
};

/**
 * Shares a page through the device's share sheet, or copies its link where there is none.
 * Rendered only where sharing is allowed (CLAUDE.md §8 F1 "Privacy", §9.7).
 */
export function ShareButton({ url, title }: ShareButtonProps) {
  const [status, setStatus] = useState('');

  const share = async () => {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ url, title });
        setStatus(shareCopy.shared);
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus(shareCopy.copied);
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus(shareCopy.failed);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        size="md"
        onClick={() => {
          void share();
        }}
      >
        {shareCopy.button}
      </Button>
      <span role="status" className="type-small text-fg-muted">
        {status}
      </span>
    </div>
  );
}
