import { defineConfig, devices } from '@playwright/test';

// Three e2e roots after PR #29 / #30 / #31 merge:
//   tests/e2e/  — overview (PR #31)
//   e2e/        — tickets (PR #30), scheduler (PR #29)
// Honour PW_BASE_URL, PLAYWRIGHT_BASE_URL, and E2E_BASE_URL conventions.
export default defineConfig({
  testDir: '.',
  testMatch: ['tests/e2e/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL:
      process.env.E2E_BASE_URL ??
      process.env.PLAYWRIGHT_BASE_URL ??
      process.env.PW_BASE_URL ??
      'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer:
    (process.env.PW_NO_SERVER ||
      process.env.PLAYWRIGHT_NO_WEB_SERVER ||
      process.env.E2E_SKIP_WEBSERVER)
      ? undefined
      : {
          command: 'npm run dev:noclean',
          url: 'http://127.0.0.1:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
});
