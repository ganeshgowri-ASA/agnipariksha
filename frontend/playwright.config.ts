import { defineConfig, devices } from '@playwright/test';

// e2e roots after PR #29 / #30 / #31 / #32 merge:
//   tests/e2e/  — overview (PR #31), responsive audit (PR #32)
//   e2e/        — tickets (PR #30), scheduler (PR #29)
// Honour PW_BASE_URL, PLAYWRIGHT_BASE_URL, and E2E_BASE_URL conventions.
export default defineConfig({
  testDir: '.',
  testMatch: ['tests/e2e/**/*.spec.ts', 'tests/responsive/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  // Bumped from 30s → 90s: turbopack first-compile for /dashboard and
  // /schedule on the CI runner regularly takes 15-30s.
  timeout: 90_000,
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
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // V2-S7 mobile / tablet responsive audit viewports.
    {
      name: 'phone-360x640',
      testMatch: 'tests/responsive/**/*.spec.ts',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 640 } },
    },
    {
      name: 'tablet-768x1024',
      testMatch: 'tests/responsive/**/*.spec.ts',
      use: { ...devices['iPad (gen 7)'], viewport: { width: 768, height: 1024 } },
    },
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
