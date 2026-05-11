import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright smoke tests for Agnipariksha.
 *
 * The frontend dev server is started automatically (or reused if already
 * running on :3000). Backend calls to /api/device/status are mocked inside
 * the specs themselves via page.route(), so these tests run without any
 * real ITECH hardware or backend process.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: process.env.PW_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.PW_NO_WEBSERVER
    ? undefined
    : {
        command: 'npm --prefix ../frontend run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
