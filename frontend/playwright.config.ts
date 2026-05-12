import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 3100);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // `next start` requires `next build` to have been run; `next dev`
    // is what CI uses end-to-end. Override with PLAYWRIGHT_WEB_SERVER
    // if your environment ships a pre-built bundle.
    command: process.env.PLAYWRIGHT_WEB_SERVER || `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/tests/reverse-current-overload`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
