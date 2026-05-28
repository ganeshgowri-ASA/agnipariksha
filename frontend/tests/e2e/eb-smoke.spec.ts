/**
 * QA harness — Equipotential Bonding (EB) standalone page smoke.
 *
 * EB per IEC 61730-2 MST 13 — low-resistance bonding between exposed
 * conductive parts and the protective earthing terminal. Verifies the
 * standalone /eb route renders and the Setup form exposes its configurable
 * fields (test current, max duration, pass threshold, bonding-point list).
 *
 * Demo-mode only — no backend WebSocket required. EB is a DMM-only flow
 * and must NOT energize the PSU, so there is no status tower / Basic Check.
 */
import { test, expect } from '@playwright/test';

test.describe('EB standalone page — /eb', () => {
  test('renders the tab and Setup form fields', async ({ page }) => {
    await page.goto('/eb');
    await expect(page.getByTestId('test-tab-eb')).toBeVisible({ timeout: 15_000 });

    // Open Setup sub-tab.
    const setupTrigger = page.getByTestId('subtab-setup');
    await expect(setupTrigger).toBeVisible();
    await setupTrigger.click();
    await expect(page.getByTestId('subtab-pane-setup')).toBeVisible();

    // Setup form fields per the spec.
    await expect(page.getByText('Test Current (A)')).toBeVisible();
    await expect(page.getByText('Duration / pair (s)')).toBeVisible();
    await expect(page.getByText('Pass Threshold (Ω)')).toBeVisible();

    // Bonding-point list with add/remove.
    await expect(page.getByTestId('eb-bonding-points')).toBeVisible();
    await expect(page.getByTestId('eb-new-point-input')).toBeVisible();
    await expect(page.getByTestId('eb-add-point')).toBeVisible();
    await expect(page.getByText('frame-corner-NW')).toBeVisible();
  });

  test('EB has no Basic Check / status tower (DMM-only, no PSU energization)', async ({ page }) => {
    await page.goto('/eb');
    await expect(page.getByTestId('test-tab-eb')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('subtab-basic-check')).toHaveCount(0);
    await expect(page.getByTestId('status-tower')).toHaveCount(0);
  });
});
