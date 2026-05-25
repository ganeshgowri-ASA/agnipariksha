/**
 * P11 — per-test schematic preview viewer.
 *
 * The wiring diagram is collapsed by default under each test's Setup
 * sub-tab. Expanding it inlines the matching SVG so it renders as a real
 * <svg> element (not an opaque <img>). This asserts that flow for BDT.
 */
import { test, expect } from '@playwright/test';

test('BDT Setup → expanding the wiring diagram shows an svg', async ({ page }) => {
  await page.goto('/dashboard?tab=bdt');
  await expect(page.getByTestId('test-tab-bdt')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('subtab-setup').click();
  await expect(page.getByTestId('subtab-pane-setup')).toBeVisible();

  const toggle = page.getByTestId('schematic-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();

  await expect(page.getByTestId('schematic-svg').locator('svg')).toBeVisible();
});
