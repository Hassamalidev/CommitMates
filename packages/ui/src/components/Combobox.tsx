'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';

import { cn } from '../lib/cn';

import { Field, controlStyles, type FieldProps } from './Field';

export type ComboboxOption = { value: string; label: string };

export type ComboboxProps = Pick<FieldProps, 'label' | 'description' | 'error' | 'className'> & {
  options: readonly ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Called as the user types, for server-side typeahead. Filtering is local when omitted. */
  onQueryChange?: (query: string) => void;
  /** Shown when nothing matches, e.g. "No departments found". */
  emptyText: string;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
};

/**
 * Text input with a filtered list (ARIA 1.2 combobox pattern): arrow keys move,
 * Enter selects, Escape closes. The selected value is also submitted with forms via `name`.
 */
export function Combobox({
  label,
  description,
  error,
  className,
  options,
  value,
  onChange,
  onQueryChange,
  emptyText,
  placeholder,
  name,
  disabled,
}: ComboboxProps) {
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? null;
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const visible = useMemo(() => {
    if (onQueryChange) return options;
    const needle = query.trim().toLowerCase();
    return needle === '' ? options : options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query, onQueryChange]);

  const choose = (option: ComboboxOption) => {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (visible.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + step + visible.length) % visible.length);
    } else if (event.key === 'Enter' && open) {
      const option = visible[activeIndex];
      if (option) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const activeId = open && visible[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  return (
    <Field label={label} description={description} error={error} className={className}>
      {(control) => (
        <div className="relative">
          <input
            {...control}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeId}
            placeholder={placeholder}
            disabled={disabled}
            value={query}
            className={controlStyles}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(true);
              if (value !== null) onChange(null);
              onQueryChange?.(event.target.value);
            }}
            onFocus={() => {
              setOpen(true);
            }}
            onBlur={() => {
              setOpen(false);
            }}
            onKeyDown={onKeyDown}
          />
          {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            hidden={!open}
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-control border border-line bg-surface py-1 shadow-pixel"
          >
            {visible.length === 0 ? (
              <li role="presentation" className="type-small px-3 py-2 text-fg-muted">
                {emptyText}
              </li>
            ) : (
              visible.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={cn(
                    'type-body flex min-h-11 cursor-pointer items-center px-3',
                    index === activeIndex && 'bg-surface-2',
                  )}
                  // Mouse down, not click: the input must not lose focus before the choice registers.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </Field>
  );
}
