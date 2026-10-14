import { cn } from '../lib/cn';

import { ICON_PATHS, type IconName } from './paths.generated';

export type IconProps = {
  name: IconName;
  /** 20 in UI, 24 in feature cards (CLAUDE.md §9.3). */
  size?: 16 | 20 | 24;
  /** Icons never carry meaning alone: give a label only when no text sits next to the icon. */
  label?: string;
  className?: string;
};

/** A Material Symbols Rounded glyph, drawn in `currentColor`. Decorative unless `label` is set. */
export function Icon({ name, size = 20, label, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      className={cn('inline-block shrink-0', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export type { IconName };
