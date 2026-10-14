import { definePackageConfig } from '@commitmates/config/vitest';

import { localTestEnv } from '../env/src/test-values';

// Source modules that go through the GitHub client read its token and contact address.
const env = Object.fromEntries(
  Object.entries(localTestEnv()).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export default definePackageConfig({ overrides: { test: { env } } });
