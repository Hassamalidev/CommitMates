import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** Small pixel-font line above the title. */
  eyebrow?: string;
  title?: string;
  /** Heading level of the title, so pages keep a logical outline. */
  titleAs?: 'h2' | 'h3' | 'h4';
  /** The hard-edged "pixel shadow" used on feature cards (CLAUDE.md §9.2). */
  pixelShadow?: boolean;
  as?: 'section' | 'article' | 'div' | 'li';
  children: ReactNode;
};

export function Card({
  eyebrow,
  title,
  titleAs: Title = 'h2',
  pixelShadow = false,
  as: Element = 'section',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Element
      {...rest}
      className={cn('rounded-card border border-line bg-surface p-4 sm:p-6', pixelShadow && 'shadow-pixel', className)}
    >
      {eyebrow || title ? (
        <header className="mb-4">
          {eyebrow ? <p className="type-eyebrow text-fg-muted">{eyebrow}</p> : null}
          {title ? <Title className="type-h3 text-fg">{title}</Title> : null}
        </header>
      ) : null}
      {children}
    </Element>
  );
}
