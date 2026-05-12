import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end smoke tests of the Agnipariksha frontend.
 *
 * Run locally with the backend and frontend already up:
 *
 *     cd backend  && python -m uvicorn backend.main:app --port 8000
 *     cd frontend && npm run dev
 *     cd frontend && npx playwright test
 *
 * CI may set BASE_URL to override the default localhost target.
 */
export default defineConfig({
  testDir: './tests-e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
