import { definePackageConfig } from '@commitmates/config/vitest';

import { localTestEnv } from '../env/src/test-values';

// The client reads its token and contact address from the environment.
const env = Object.fromEntries(
  Object.entries(localTestEnv()).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export default definePackageConfig({ overrides: { test: { env } } });
