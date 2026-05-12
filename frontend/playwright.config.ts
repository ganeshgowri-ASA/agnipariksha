import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test config for Agnipariksha frontend.
 *
 * Used in CI to verify the Humidity Freeze tab renders the Figure 9
 * envelope and posts a run successfully against the mocked backend.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'npm run dev:noclean',
        port: 3000,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
