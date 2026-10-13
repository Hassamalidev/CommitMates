import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest preset. Coverage thresholds are passed per package and enforced
 * whenever coverage runs (CLAUDE.md §11.1); never lower one to get green.
 *
 * @param {object} [options]
 * @param {'node' | 'jsdom'} [options.environment]
 * @param {string[]} [options.setupFiles]
 * @param {{ lines?: number, functions?: number, branches?: number, statements?: number }} [options.thresholds]
 * @param {string[]} [options.coverageExclude]
 * @param {import('vitest/config').UserConfig} [options.overrides]
 */
export function definePackageConfig(options = {}) {
  const { environment = 'node', setupFiles = [], thresholds, coverageExclude = [], overrides = {} } = options;

  return defineConfig({
    ...overrides,
    test: {
      environment,
      setupFiles,
      include: ['src/**/*.test.{ts,tsx}', 'eslint/**/*.test.js', 'scripts/**/*.test.ts'],
      passWithNoTests: false,
      restoreMocks: true,
      unstubEnvs: true,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['**/*.test.{ts,tsx}', '**/__tests__/**', '**/__fixtures__/**', '**/index.ts', ...coverageExclude],
        reporter: ['text-summary', 'lcov'],
        ...(thresholds ? { thresholds } : {}),
      },
      ...overrides.test,
    },
  });
}
