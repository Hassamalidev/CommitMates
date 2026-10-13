import { fileURLToPath } from 'node:url';

import { definePackageConfig } from '@commitmates/config/vitest';

export default definePackageConfig({
  overrides: {
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  },
});
