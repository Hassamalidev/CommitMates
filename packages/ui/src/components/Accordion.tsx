import type { ReactNode } from 'react';

import { Icon } from '../icons/Icon';
import { cn } from '../lib/cn';

export type AccordionItem = { value: string; title: string; content: ReactNode };

export type AccordionProps = {
  items: readonly AccordionItem[];
  /** Heading level of each item's title, so the page outline stays logical. */
  headingLevel?: 'h2' | 'h3' | 'h4';
  className?: string;
};

/**
 * Collapsible sections; any number can be open at once. Built on native `<details>`, which the
 * browser opens, closes and exposes to assistive technology itself, so it ships no JavaScript
 * (ADR-011) and works before hydration.
 */
export function Accordion({ items, headingLevel: Heading = 'h3', className }: AccordionProps) {
  return (
    <div className={cn('border-t border-line', className)}>
      {items.map((item) => (
        <details key={item.value} className="group border-b border-line">
          <summary className="type-body flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 text-left font-semibold text-fg [&::-webkit-details-marker]:hidden">
            <Heading className="type-body font-semibold">{item.title}</Heading>
            <Icon
              name="keyboard_arrow_down"
              className="text-fg-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="type-body pb-4 text-fg-muted">{item.content}</div>
        </details>
      ))}
    </div>
  );
}
