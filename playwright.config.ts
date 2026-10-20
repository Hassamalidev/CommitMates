import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

import { localTestEnv } from './packages/env/src/test-values';

// Real keys for the local Supabase stack live in the root .env.local (never committed).
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

/** Port of the production build that Playwright starts; separate from `pnpm dev`. */
const E2E_PORT = Number(process.env.E2E_PORT ?? '3100');
const baseURL = `http://127.0.0.1:${E2E_PORT}`;
const isCi = Boolean(process.env.CI);

/** Real variables from the shell or CI win over the local defaults. */
function definedEnv(source: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') result[key] = value;
  }
  return result;
}

// Tests that run a job in the test process (e2e/streaks.spec.ts) need the same environment as the web
// server below: local defaults, with real variables from the shell, CI or .env.local winning.
for (const [key, value] of Object.entries(localTestEnv())) {
  if (value !== undefined && (process.env[key] === undefined || process.env[key] === '')) process.env[key] = value;
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  // Flows that sign in, render server pages and run Server Actions share one server and one Postgres
  // across parallel workers; under that load a 30 s default is too tight for multi-step tests.
  timeout: 60_000,
  // Tool results arrive through a job and an event stream; allow them more than 5 s under the same load.
  expect: { timeout: 10_000 },
  forbidOnly: true,
  retries: isCi ? 1 : 0,
  // One local `next start` server and one Postgres serve every worker; more than two locally
  // starve Server Actions on a busy machine. CI keeps Playwright's default.
  ...(isCi ? {} : { workers: 2 }),
  reporter: isCi ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // The smallest supported width (CLAUDE.md §2.9).
    // Tests that change shared database rows run once, in the desktop project.
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } },
      grepInvert: /@shared-state/,
    },
  ],
  webServer: {
    command: `pnpm --filter @commitmates/web exec next start --port ${E2E_PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !isCi,
    // The site URL must match the address the browser uses, or same-origin checks fail.
    env: definedEnv({ ...localTestEnv(), ...definedEnv(process.env), NEXT_PUBLIC_SITE_URL: baseURL }),
    timeout: 120_000,
  },
});
