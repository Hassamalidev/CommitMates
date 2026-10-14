import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

const buttonStyles = cva(
  'relative inline-flex items-center justify-center gap-2 rounded-control font-sans font-semibold ' +
    'transition-colors duration-150 ease-out select-none ' +
    'disabled:cursor-not-allowed disabled:opacity-60 aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:brightness-110',
        secondary: 'border border-line bg-surface text-fg hover:border-line-strong',
        ghost: 'text-fg hover:bg-surface-2',
        danger: 'border border-state-error bg-surface text-state-error hover:bg-surface-2',
      },
      // 44px minimum touch height on mobile (CLAUDE.md §9.4).
      size: {
        sm: 'min-h-11 px-3 text-sm sm:min-h-8',
        md: 'min-h-11 px-4 text-sm sm:min-h-10',
        lg: 'min-h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles> & {
    /** Shows the pixel spinner, keeps the width, and blocks further clicks. */
    loading?: boolean;
    children: ReactNode;
  };

export function Button({
  variant,
  size,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(buttonStyles({ variant, size }), className)}
    >
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
      {loading ? (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center font-mono">
          <span className="animate-pixel-dots tracking-widest">▪▪▪</span>
        </span>
      ) : null}
    </button>
  );
}

export { buttonStyles };
