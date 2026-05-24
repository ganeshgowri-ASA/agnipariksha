/**
 * P9 — Basic Check tower parity.
 *
 * The 4-lamp readiness tower (Power Supply · Backend · Frontend · Cloud/AI)
 * must appear on every PSU-energizing test tab and must NOT appear on tabs
 * that never energize the supply. Demo-mode only (no backend required).
 */
import { test, expect, type Page } from '@playwright/test';

// Tabs that energize the PSU → tower required.
const PSU_TABS = ['tc', 'hf', 'letid', 'bdt', 'rco'] as const;
// Tabs that never energize the PSU → tower must be absent.
const NON_PSU_TABS = ['gct', 'dh'] as const;

async function openTab(page: Page, key: string): Promise<void> {
  await page.goto(`/dashboard?tab=${key}`);
  await expect(page.getByTestId(`test-tab-${key}`)).toBeVisible({ timeout: 15_000 });
}

test.describe('Basic Check tower — PSU-energizing tabs show the tower', () => {
  for (const key of PSU_TABS) {
    test(`${key.toUpperCase()} renders the readiness tower`, async ({ page }) => {
      await openTab(page, key);
      await expect(page.getByTestId('status-tower')).toBeVisible();
      // All four canonical lamps are present.
      for (const lamp of ['power-supply', 'backend', 'frontend', 'cloud-ai']) {
        await expect(page.getByTestId(`status-lamp-${lamp}`)).toBeVisible();
      }
    });
  }
});

test.describe('Basic Check tower — non-PSU tabs hide the tower', () => {
  for (const key of NON_PSU_TABS) {
    test(`${key.toUpperCase()} does not render the readiness tower`, async ({ page }) => {
      await openTab(page, key);
      await expect(page.getByTestId('status-tower')).toHaveCount(0);
    });
  }
});
