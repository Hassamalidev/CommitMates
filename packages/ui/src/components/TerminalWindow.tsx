'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export type TerminalLine = {
  /** `command` lines get a `$` prompt; the others are colored by meaning. */
  type: 'command' | 'info' | 'success' | 'warn' | 'error';
  text: string;
};

const lineColor: Record<TerminalLine['type'], string> = {
  command: 'text-fg',
  info: 'text-fg-muted',
  success: 'text-state-done',
  warn: 'text-state-working',
  error: 'text-state-error',
};

export type TerminalWindowProps = {
  title: string;
  lines: readonly TerminalLine[];
  /** Rendered under the lines, e.g. an input row. */
  children?: ReactNode;
  className?: string;
};

/**
 * Window chrome with a monospace body. New lines are announced politely to screen
 * readers and scrolled into view (CLAUDE.md §9.4).
 */
export function TerminalWindow({ title, lines, children, className }: TerminalWindowProps) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = body.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines.length]);

  return (
    <section
      aria-label={title}
      className={cn('overflow-hidden rounded-card border border-line bg-surface shadow-pixel', className)}
    >
      <header className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-3 rounded-full bg-state-error" />
          <span className="size-3 rounded-full bg-state-working" />
          <span className="size-3 rounded-full bg-state-done" />
        </span>
        <span className="type-code truncate text-fg-muted">{title}</span>
      </header>
      {/* A scrollable region must be reachable by keyboard. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div ref={body} tabIndex={0} role="log" aria-live="polite" className="type-code max-h-72 overflow-auto p-4">
        {lines.map((line, index) => (
          <p key={`${index}-${line.text}`} data-line={line.type} className={cn('break-words whitespace-pre-wrap', lineColor[line.type])}>
            {line.type === 'command' ? <span className="text-accent">$ </span> : null}
            {line.text}
          </p>
        ))}
      </div>
      {children ? <div className="border-t border-line p-4">{children}</div> : null}
    </section>
  );
}
