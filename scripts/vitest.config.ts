import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.resolve(import.meta.dirname, '..'),
  cacheDir: 'node_modules/.vitest-scripts',
  test: {
    environment: 'node',
    fsModuleCachePath: 'node_modules/.vitest-cache-scripts',
    include: ['scripts/**/*.test.ts'],
    restoreMocks: true,
  },
});
