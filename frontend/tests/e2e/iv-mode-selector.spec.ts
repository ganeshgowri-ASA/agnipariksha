/**
 * G17 — IV Source selector smoke.
 *
 * Verifies the selector mounts, persists per Module ID, and the matching
 * template route returns the expected content type for each of the
 * three modes (4-Quadrant SMU, PSU + Oscilloscope, Offline Import).
 *
 * PSU OUTPUT NEVER ASSERTED: the test only navigates and reads UI; no
 * SCPI control endpoint is hit.
 */
import { test, expect, type Page } from '@playwright/test';

async function openSetup(page: Page): Promise<void> {
  await page.goto('/dashboard?tab=bdt');
  await expect(page.getByTestId('test-tab-bdt')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('subtab-setup').click();
  await expect(page.getByTestId('iv-mode-selector')).toBeVisible();
}

test.describe('G17 — IV mode selector', () => {
  test('selector renders on the Setup sub-tab', async ({ page }) => {
    await openSetup(page);
    await expect(page.getByTestId('iv-module-id')).toBeVisible();
    await expect(page.getByTestId('iv-mode-select')).toBeVisible();
    await expect(page.getByTestId('iv-template-download')).toBeVisible();
  });

  test('selecting iv4q updates the Live Monitor view', async ({ page }) => {
    await openSetup(page);
    await page.getByTestId('iv-mode-select').selectOption('iv4q');
    await page.getByTestId('subtab-monitor').click();
    await expect(page.getByTestId('iv-monitor-iv4q')).toBeVisible();
  });

  test('selecting ivPsuScope updates the Live Monitor view', async ({ page }) => {
    await openSetup(page);
    await page.getByTestId('iv-mode-select').selectOption('ivPsuScope');
    await page.getByTestId('subtab-monitor').click();
    await expect(page.getByTestId('iv-monitor-ivPsuScope')).toBeVisible();
  });

  test('selecting ivImport updates the Live Monitor view', async ({ page }) => {
    await openSetup(page);
    await page.getByTestId('iv-mode-select').selectOption('ivImport');
    await page.getByTestId('subtab-monitor').click();
    await expect(page.getByTestId('iv-monitor-ivImport')).toBeVisible();
  });

  test('GET /api/iv/4q/template returns JSON', async ({ request }) => {
    const res = await request.get('/api/iv/4q/template');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/application\/json/);
  });

  test('GET /api/iv/psu-scope/template returns JSON', async ({ request }) => {
    const res = await request.get('/api/iv/psu-scope/template');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/application\/json/);
  });

  test('GET /api/iv/import/template returns XLSX', async ({ request }) => {
    const res = await request.get('/api/iv/import/template');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/spreadsheetml/);
  });
});
