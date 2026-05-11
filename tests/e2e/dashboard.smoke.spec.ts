import { test, expect } from '@playwright/test';

/**
 * Smoke: the dashboard renders and exposes the 6 IEC test tabs.
 * Backend /api/device/status is mocked so this runs without hardware.
 */

const MOCK_DEVICE_STATUS_OK = {
  connected: true,
  model: 'ITECH PV6000',
  ip: '192.168.200.100',
  port: 30000,
  firmware: 'IT9000 v1.0.3.3',
  demo_mode: false,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/device/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DEVICE_STATUS_OK),
    });
  });
});

test('dashboard loads and shows the 6 IEC test tabs', async ({ page }) => {
  await page.goto('/');

  // The page should reach a usable state quickly.
  await expect(page).toHaveTitle(/agnipariksha|pv|reliability/i);

  // Each test tab label must be visible — guards against accidentally
  // removing a tab during a refactor.
  for (const tab of ['TC', 'HF', 'LeTID', 'BDT', 'RCO', 'GCT']) {
    await expect(page.getByRole('tab', { name: new RegExp(`\\b${tab}\\b`, 'i') }))
      .toBeVisible();
  }
});

test('device-status banner reflects mocked backend', async ({ page }) => {
  await page.goto('/');

  // Some part of the UI must surface the connected device string.
  // We assert against the page body to stay robust to specific component IDs.
  await expect(page.locator('body')).toContainText(/ITECH PV6000|192\.168\.200\.100/);
});

test('disconnected device surfaces an error/warning state', async ({ page }) => {
  // Override the route for this single test
  await page.route('**/api/device/status', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ connected: false, error: 'device unreachable' }),
    });
  });

  await page.goto('/');
  // The UI should not crash; either an error banner or the demo-mode toggle
  // must remain reachable so the operator can recover.
  await expect(page.locator('body')).toContainText(/demo|disconnect|unreachable|offline/i);
});
