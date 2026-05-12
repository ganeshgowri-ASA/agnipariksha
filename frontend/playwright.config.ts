import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Agnipariksha frontend e2e tests.
 *
 * Spins up the Next.js dev server on port 3000 and the Python backend
 * (demo mode) on port 8000 before running specs. Both processes are
 * left to the developer / CI to provide via the standard ``npm run dev``
 * + ``python -m backend`` workflow when running locally; this config
 * just points at them.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
