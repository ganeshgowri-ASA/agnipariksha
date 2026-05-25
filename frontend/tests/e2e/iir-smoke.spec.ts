/**
 * Smoke — Inverted IR (forward-bias IR thermography) tab.
 *
 * DEMO-only: navigates to the standalone /iir route and asserts the Setup
 * sub-tab fields render. P7 of 12 in the 2026-05-24 coordinated pack.
 */
import { test, expect } from '@playwright/test';

test.describe('IIR — Inverted IR thermography', () => {
  test('/iir renders Setup fields', async ({ page }) => {
    await page.goto('/iir');
    await expect(page.getByTestId('test-tab-iir')).toBeVisible({ timeout: 15_000 });

    // Setup is the default sub-tab; assert each configured field renders.
    await expect(page.getByTestId('subtab-pane-setup')).toBeVisible();
    for (const id of [
      'iir-setup-current',
      'iir-setup-soak',
      'iir-setup-camera',
      'iir-setup-emissivity',
      'iir-setup-ambient',
    ]) {
      await expect(page.getByTestId(id), `setup field ${id}`).toBeVisible();
    }
  });

  test('/iir Live Monitor renders thermogram + legend', async ({ page }) => {
    await page.goto('/iir');
    await page.getByTestId('subtab-monitor').click();
    await expect(page.getByTestId('iir-thermogram')).toBeVisible();
    await expect(page.getByTestId('iir-legend')).toBeVisible();
  });
});
