import { cn } from '@commitmates/ui';
import type { ReactNode } from 'react';

export type SectionProps = {
  id?: string;
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
  className?: string;
};

/** A landing-page section: eyebrow, H2, optional intro, content. */
export function Section({ id, eyebrow, title, intro, children, className }: SectionProps) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn('scroll-mt-4 py-12 sm:py-16', className)}>
      <div className="mx-auto max-w-content px-4">
        <p className="type-eyebrow text-fg-muted">{eyebrow}</p>
        <h2 id={id ? `${id}-title` : undefined} className="type-h2 mt-1">
          {title}
        </h2>
        {intro ? <p className="type-body mt-2 max-w-reading text-fg-muted">{intro}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}
