'use client';

import { Accordion as RadixAccordion } from 'radix-ui';
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

/** Collapsible sections; any number can be open at once. */
export function Accordion({ items, headingLevel: Heading = 'h3', className }: AccordionProps) {
  return (
    <RadixAccordion.Root type="multiple" className={cn('border-t border-line', className)}>
      {items.map((item) => (
        <RadixAccordion.Item key={item.value} value={item.value} className="border-b border-line">
          <RadixAccordion.Header asChild>
            <Heading>
              <RadixAccordion.Trigger className="group type-body flex min-h-11 w-full items-center justify-between gap-4 py-3 text-left font-semibold text-fg">
                {item.title}
                <Icon
                  name="keyboard_arrow_down"
                  className="text-fg-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
                />
              </RadixAccordion.Trigger>
            </Heading>
          </RadixAccordion.Header>
          <RadixAccordion.Content className="type-body pb-4 text-fg-muted">{item.content}</RadixAccordion.Content>
        </RadixAccordion.Item>
      ))}
    </RadixAccordion.Root>
  );
}
