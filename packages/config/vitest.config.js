import { definePackageConfig } from './vitest/preset.js';

export default definePackageConfig({ overrides: { test: { testTimeout: 30000 } } });
