'use client';

import { Button, type ButtonProps } from '@commitmates/ui';
import { useActionState, type ReactNode } from 'react';

import type { ActionResult } from '@/server/action';

export type ActionFormProps = {
  action: (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;
  /** Hidden values sent with the form. */
  values?: Record<string, string>;
  submitLabel: string;
  /** Shown after a successful submit. */
  successMessage?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  /** Visible fields, rendered before the submit button. */
  children?: ReactNode;
  className?: string;
};

/**
 * A native form bound to a Server Action (CLAUDE.md §10.8). It works without JavaScript;
 * with it, the button shows progress and the action's error appears inline.
 */
export function ActionForm({
  action,
  values = {},
  submitLabel,
  successMessage,
  variant = 'secondary',
  size = 'sm',
  children,
  className,
}: ActionFormProps) {
  const [result, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <Button type="submit" variant={variant} size={size} loading={pending}>
        {submitLabel}
      </Button>
      {result && !result.ok ? (
        <p role="alert" className="type-small mt-1 text-state-error">
          {result.error.message}
        </p>
      ) : null}
      {result?.ok && successMessage ? (
        <p role="status" className="type-small mt-1 text-state-done">
          {successMessage}
        </p>
      ) : null}
    </form>
  );
}
