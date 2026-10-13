import axe from 'axe-core';

/** Impact levels that fail a test (CLAUDE.md §9.10). */
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

/**
 * Runs axe on rendered markup and returns the serious and critical violations.
 * Color contrast is checked by `pnpm check:contrast` and in Playwright instead,
 * because jsdom does not compute styles.
 *
 * @param {Element} container
 * @returns {Promise<{ id: string, impact: string | null | undefined, help: string, nodes: number }[]>}
 */
export async function findA11yViolations(container) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return results.violations
    .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.length,
    }));
}
