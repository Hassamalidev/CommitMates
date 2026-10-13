import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.resolve(import.meta.dirname, '..'),
  cacheDir: 'node_modules/.vitest-scripts',
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
    restoreMocks: true,
  },
});
