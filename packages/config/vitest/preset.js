import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const DOM_SETUP = fileURLToPath(new URL('./setup-dom.js', import.meta.url));

/**
 * Shared Vitest preset. Coverage thresholds are passed per package and enforced
 * whenever coverage runs (CLAUDE.md §11.1); never lower one to get green.
 *
 * @param {object} [options]
 * @param {boolean} [options.dom] Run in jsdom with Testing Library matchers and cleanup.
 * @param {string[]} [options.setupFiles]
 * @param {{ lines?: number, functions?: number, branches?: number, statements?: number }} [options.thresholds]
 * @param {string[]} [options.coverageExclude]
 * @param {Record<string, unknown>} [options.overrides]
 */
export function definePackageConfig(options = {}) {
  const { dom = false, setupFiles = [], thresholds, coverageExclude = [], overrides = {} } = options;

  return defineConfig({
    // Packages run in parallel under Turborepo; a shared cache directory makes them race.
    cacheDir: 'node_modules/.vitest',
    ...overrides,
    test: {
      environment: dom ? 'jsdom' : 'node',
      setupFiles: dom ? [DOM_SETUP, ...setupFiles] : setupFiles,
      include: ['src/**/*.test.{ts,tsx}', '{eslint,testing}/**/*.test.js'],
      passWithNoTests: false,
      // Integration tests create a scratch database per file.
      hookTimeout: 60000,
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
