import { useId, type ReactNode } from 'react';

import { Icon } from '../icons/Icon';
import { cn } from '../lib/cn';

export type FieldProps = {
  label: string;
  /** Helper text below the control. */
  description?: string | undefined;
  /** Error text; shown in the error color with an icon and announced to screen readers. */
  error?: string | undefined;
  className?: string | undefined;
  children: (control: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': true | undefined }) => ReactNode;
};

/**
 * Label above, helper text below, error text linked with `aria-describedby`
 * (CLAUDE.md §9.4, §9.10). No placeholder-only labels.
 */
export function Field({ label, description, error, className, children }: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="type-small font-semibold text-fg">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {description ? (
        <p id={descriptionId} className="type-small text-fg-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="type-small flex items-start gap-1.5 text-state-error">
          <Icon name="error" size={16} className="mt-0.5" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Shared look of text controls. */
export const controlStyles =
  'w-full min-h-11 rounded-control border border-line bg-surface px-3 text-fg type-body ' +
  'placeholder:text-fg-muted hover:border-line-strong aria-invalid:border-state-error ' +
  'disabled:cursor-not-allowed disabled:opacity-60';
