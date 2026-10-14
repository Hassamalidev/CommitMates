import type { ComponentPropsWithoutRef, ElementType } from 'react';

type VisuallyHiddenProps<T extends ElementType> = {
  /** Element to render; defaults to `span`. Use `div` or `table` for block content. */
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, 'as'>;

/**
 * Content for screen readers only: the text alternative for icons, charts and
 * companions (CLAUDE.md §9.10).
 */
export function VisuallyHidden<T extends ElementType = 'span'>({
  as,
  className,
  ...rest
}: VisuallyHiddenProps<T>) {
  const Component: ElementType = as ?? 'span';
  const classes = typeof className === 'string' && className.length > 0 ? `sr-only ${className}` : 'sr-only';
  // A table ignores the 1px width of `sr-only` and would widen the page; a clipped wrapper keeps it out of the layout.
  if (Component === 'table') {
    return (
      <div className="sr-only">
        <table {...rest} className={className} />
      </div>
    );
  }
  return <Component {...rest} className={classes} />;
}
