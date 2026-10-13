import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

import { Field, controlStyles, type FieldProps } from './Field';

type FieldText = Pick<FieldProps, 'label' | 'description' | 'error'>;

export type InputProps = FieldText & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'aria-describedby'>;

export function Input({ label, description, error, className, ...rest }: InputProps) {
  return (
    <Field label={label} description={description} error={error} className={className}>
      {(control) => <input {...rest} {...control} className={controlStyles} />}
    </Field>
  );
}

export type TextareaProps = FieldText &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'aria-describedby'>;

export function Textarea({ label, description, error, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <Field label={label} description={description} error={error} className={className}>
      {(control) => <textarea {...rest} {...control} rows={rows} className={cn(controlStyles, 'py-2')} />}
    </Field>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = FieldText &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'aria-describedby' | 'children'> & {
    options: readonly SelectOption[];
    /** Shown as a disabled first option when nothing is selected. */
    placeholder?: string;
  };

/** A native select: the platform's own keyboard, touch and screen-reader behavior. */
export function Select({ label, description, error, className, options, placeholder, ...rest }: SelectProps) {
  return (
    <Field label={label} description={description} error={error} className={className}>
      {(control) => (
        <select {...rest} {...control} className={cn(controlStyles, 'pr-8')}>
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
