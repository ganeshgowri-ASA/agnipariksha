/**
 * Smoke — Potential-Induced Degradation (PID) tab, IEC TS 62804-1.
 *
 * Demo-mode only (no backend WebSocket). Verifies the PID tab renders,
 * every sub-tab paints, and the DEMO retention curve evaluates to a
 * verdict above the 95% pass line.
 */
import { test, expect, type Page } from '@playwright/test';

async function openPid(page: Page): Promise<void> {
  await page.goto('/dashboard?tab=pid');
  await expect(page.getByTestId('test-tab-pid')).toBeVisible({ timeout: 15_000 });
}

async function selectSubTab(page: Page, key: string): Promise<void> {
  await page.getByTestId(`subtab-${key}`).click();
  await expect(page.getByTestId(`subtab-pane-${key}`)).toBeVisible();
}

test.describe('PID tab — IEC TS 62804-1', () => {
  for (const key of ['setup', 'monitor', 'data', 'analysis', 'report']) {
    test(`PID → ${key} renders`, async ({ page }) => {
      await openPid(page);
      await selectSubTab(page, key);
    });
  }

  test('Live Monitor exposes the periodic Pmax table', async ({ page }) => {
    await openPid(page);
    await selectSubTab(page, 'monitor');
    await expect(page.getByTestId('pid-pmax-table')).toBeVisible();
    await expect(page.getByTestId('pid-add-point')).toBeVisible();
  });

  test('Analysis shows a PASS verdict for the DEMO retention curve', async ({ page }) => {
    await openPid(page);
    await selectSubTab(page, 'analysis');
    await expect(page.getByTestId('pid-retention-chart')).toBeVisible();
    await expect(page.getByTestId('pid-verdict').first()).toHaveText('PASS');
  });
});
