import { defineConfig, devices } from '@playwright/test';

// Three e2e roots after PR #29 / #30 / #31 merge:
//   tests/e2e/  — overview (PR #31)
//   e2e/        — tickets (PR #30), scheduler (PR #29)
// Honour PW_BASE_URL, PLAYWRIGHT_BASE_URL, and E2E_BASE_URL conventions.
export default defineConfig({
  testDir: '.',
  testMatch: ['tests/e2e/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  // Bumped from 30s → 90s after PR #29: turbopack first-compile for
  // /dashboard and /schedule on the CI runner regularly takes 15-30s.
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
          env: {
            // MSW handlers for /api/procurement/* are wired into the dev
            // server. Opt-in via NEXT_PUBLIC_MSW so a manually started
            // dev shell doesn't have to know about it.
            NEXT_PUBLIC_MSW: '1',
          },
        },
});
