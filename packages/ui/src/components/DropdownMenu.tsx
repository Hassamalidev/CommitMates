'use client';

import { DropdownMenu as RadixMenu } from 'radix-ui';
import type { ReactNode } from 'react';

import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../lib/cn';

export type DropdownMenuItem = {
  key: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /** Styles the item as destructive. */
  danger?: boolean;
  disabled?: boolean;
};

export type DropdownMenuProps = {
  /** The element that opens the menu, normally a Button. Its text also names the menu. */
  trigger: ReactNode;
  items: readonly DropdownMenuItem[];
  align?: 'start' | 'center' | 'end';
};

/** A menu of actions with arrow-key navigation and type-ahead. */
export function DropdownMenu({ trigger, items, align = 'end' }: DropdownMenuProps) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded-control border border-line bg-surface p-1 shadow-pixel"
        >
          {items.map((item) => (
            <RadixMenu.Item
              key={item.key}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                'type-small flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-3 outline-none sm:min-h-9',
                'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 data-[highlighted]:bg-surface-2',
                item.danger ? 'text-state-error' : 'text-fg',
              )}
            >
              {item.icon ? <Icon name={item.icon} size={16} /> : null}
              {item.label}
            </RadixMenu.Item>
          ))}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
