'use client';

import { Tabs as RadixTabs } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type TabItem = { value: string; label: string; content: ReactNode; disabled?: boolean };

export type TabsProps = {
  /** Names the tab list for screen readers. */
  label: string;
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
};

export function Tabs({ label, items, value, defaultValue, onValueChange, className }: TabsProps) {
  const initial = defaultValue ?? items[0]?.value;
  return (
    <RadixTabs.Root
      {...(value !== undefined ? { value } : {})}
      {...(value === undefined && initial !== undefined ? { defaultValue: initial } : {})}
      {...(onValueChange ? { onValueChange } : {})}
      className={className}
    >
      <RadixTabs.List aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn(
              'type-small min-h-11 shrink-0 border-b-2 border-transparent px-4 font-semibold text-fg-muted',
              'transition-colors duration-150 hover:text-fg',
              'data-[state=active]:border-accent data-[state=active]:text-fg disabled:opacity-60',
            )}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="pt-4">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
