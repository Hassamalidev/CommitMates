import { findA11yViolations } from '@commitmates/config/testing/axe';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VisuallyHidden } from './VisuallyHidden';

describe('VisuallyHidden', () => {
  it('renders screen-reader-only text in a span', () => {
    render(<VisuallyHidden>Your companion is working</VisuallyHidden>);
    const element = screen.getByText('Your companion is working');
    expect(element.tagName).toBe('SPAN');
    expect(element).toHaveClass('sr-only');
  });

  it('renders the requested element and keeps extra classes', () => {
    render(
      <VisuallyHidden as="div" className="chart-data" data-testid="alt">
        42 commits
      </VisuallyHidden>,
    );
    const element = screen.getByTestId('alt');
    expect(element.tagName).toBe('DIV');
    expect(element).toHaveClass('sr-only', 'chart-data');
  });

  it('wraps a table so it cannot widen the page', () => {
    render(
      <VisuallyHidden as="table">
        <tbody>
          <tr>
            <td>42</td>
          </tr>
        </tbody>
      </VisuallyHidden>,
    );
    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('sr-only');
  });

  it('has no serious accessibility violations', async () => {
    const { container } = render(
      <main>
        <h1>Dev Card</h1>
        <VisuallyHidden>Languages: TypeScript 60%, Python 40%</VisuallyHidden>
      </main>,
    );
    expect(await findA11yViolations(container)).toEqual([]);
  });
});
