import { defineConfig } from 'vitest/config';

// Lets `pnpm test:watch` and editor integrations run every project at once.
// CI and `pnpm test` run each project through Turborepo instead, for caching.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
