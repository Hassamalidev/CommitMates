import { definePackageConfig } from '@commitmates/config/vitest';

import { localTestEnv } from '../env/src/test-values';

// Services read secrets (encryption key, pepper, bootstrap admin) from the environment.
const env = Object.fromEntries(
  Object.entries(localTestEnv()).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export default definePackageConfig({ overrides: { test: { env } } });
