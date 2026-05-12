import { defineConfig, devices } from '@playwright/test';

/**
 * Mobile / tablet responsive audit suite for the Agnipariksha dashboard.
 *
 * Two viewports are exercised — 360x640 (Android phone) and 768x1024
 * (iPad portrait) — matching the V2-S7 acceptance criteria. The runner
 * spins up the Next.js dev server automatically via ``webServer``.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'phone-360x640',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 640 } },
    },
    {
      name: 'tablet-768x1024',
      use: { ...devices['iPad (gen 7)'], viewport: { width: 768, height: 1024 } },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev:noclean',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
