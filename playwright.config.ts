import { defineConfig, devices } from '@playwright/test';

/** Port of the production build that Playwright starts; separate from `pnpm dev`. */
const E2E_PORT = Number(process.env.E2E_PORT ?? '3100');
const baseURL = `http://127.0.0.1:${E2E_PORT}`;
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // The smallest supported width (CLAUDE.md §2.9).
    { name: 'mobile-360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    command: `pnpm --filter @commitmates/web exec next start --port ${E2E_PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !isCi,
    timeout: 120_000,
  },
});
