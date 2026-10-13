import { definePackageConfig } from '@commitmates/config/vitest';

export default definePackageConfig({ dom: true, setupFiles: ['./src/test-setup.ts'] });
