import { test, expect } from '@playwright/test';

const KPI_TILES = [
  'kpi-total-runs',
  'kpi-pass-rate',
  'kpi-in-flight',
  'kpi-alarms',
  'kpi-psu-state',
  'kpi-modules-checked',
];

test('/dashboard/overview renders KPI tiles and Basic Check table', async ({ page }) => {
  await page.goto('/dashboard/overview');
  await expect(page.getByTestId('dashboard-overview-root')).toBeVisible();

  for (const id of KPI_TILES) {
    await expect(page.getByTestId(id), `tile ${id}`).toBeVisible();
  }

  await expect(page.getByTestId('basic-check-table')).toBeVisible();
});

test('PSU output state shows OFF in DEMO mode', async ({ page }) => {
  // Force the /api/health response into the demo branch so we exercise the
  // safety rule: PSU output MUST read OFF when the backend reports demo=true.
  await page.route('**/api/health', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        frontend: 'ok',
        backend: { status: 'ok', demo: true, scpi_reachable: false, version: 'test' },
        timestamp: new Date().toISOString(),
      }),
    });
  });

  await page.goto('/dashboard/overview');
  const psu = page.getByTestId('kpi-psu-state');
  await expect(psu).toBeVisible();
  await expect(psu).toContainText('OFF');
  await expect(psu).toContainText(/DEMO/i);
});
