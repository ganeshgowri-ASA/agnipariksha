import { defineConfig, devices } from '@playwright/test';

// Two e2e roots after PR #30 / PR #31 merged:
//   tests/e2e/  — overview spec (PR #31)
//   e2e/        — tickets spec  (PR #30)
// Honour both PW_BASE_URL and PLAYWRIGHT_BASE_URL env conventions.
export default defineConfig({
  testDir: '.',
  testMatch: ['tests/e2e/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  timeout: 30_000,
  fullyParallel: true,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? process.env.PW_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: (process.env.PW_NO_SERVER || process.env.PLAYWRIGHT_NO_WEB_SERVER)
    ? undefined
    : {
        command: 'npm run dev:noclean',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
