/**
 * G17 — IV Source selector smoke.
 *
 * Verifies each of the three modes (4-Quadrant SMU, PSU + Oscilloscope,
 * Offline Import):
 *   1. Selector renders on the Setup sub-tab.
 *   2. Switching modes updates the LiveMonitor / Data / Analysis / Report
 *      banners so downstream tabs render the right view.
 *   3. The matching template route returns the right content type.
 *
 * PSU OUTPUT NEVER ASSERTED: the test only navigates and reads UI; no
 * SCPI control endpoint is hit.
 */
import { test, expect, type Page } from '@playwright/test';

interface ModeCase {
  storeValue: 'iv4q' | 'ivPsuScope' | 'ivImport';
  optionLabel: string;
  templateSlug: '4q' | 'psu-scope' | 'import';
  expectedContentType: RegExp;
  monitorTestId: string;
}

const MODES: ModeCase[] = [
  {
    storeValue: 'iv4q',
    optionLabel: '4-Quadrant SMU',
    templateSlug: '4q',
    expectedContentType: /application\/json/,
    monitorTestId: 'iv-monitor-iv4q',
  },
  {
    storeValue: 'ivPsuScope',
    optionLabel: 'PSU + Oscilloscope',
    templateSlug: 'psu-scope',
    expectedContentType: /application\/json/,
    monitorTestId: 'iv-monitor-ivPsuScope',
  },
  {
    storeValue: 'ivImport',
    optionLabel: 'Offline Import',
    templateSlug: 'import',
    expectedContentType: /spreadsheetml/,
    monitorTestId: 'iv-monitor-ivImport',
  },
];

async function openSetup(page: Page): Promise<void> {
  await page.goto('/dashboard?tab=bdt');
  await expect(page.getByTestId('test-tab-bdt')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('subtab-setup').click();
  await expect(page.getByTestId('subtab-pane-setup')).toBeVisible();
  await expect(page.getByTestId('iv-mode-selector')).toBeVisible();
}

test.describe('G17 — IV mode selector', () => {
  for (const mode of MODES) {
    test(`${mode.optionLabel} drives all four sub-tabs`, async ({ page }) => {
      await openSetup(page);

      await page.getByTestId('iv-mode-select').selectOption(mode.storeValue);
      await expect(page.getByTestId('iv-mode-select')).toHaveValue(mode.storeValue);

      await page.getByTestId('subtab-monitor').click();
      await expect(page.getByTestId(`iv-mode-banner-${mode.storeValue}`)).toBeVisible();
      await expect(page.getByTestId(mode.monitorTestId)).toBeVisible();

      for (const pane of ['data', 'analysis', 'report'] as const) {
        await page.getByTestId(`subtab-${pane}`).click();
        await expect(page.getByTestId(`iv-mode-banner-${mode.storeValue}`)).toBeVisible();
      }
    });
  }

  test('module ID input persists per-DUT selection', async ({ page }) => {
    await openSetup(page);
    await page.getByTestId('iv-module-id').fill('MOD-A');
    await page.getByTestId('iv-mode-select').selectOption('ivImport');
    await page.getByTestId('iv-module-id').fill('MOD-B');
    await expect(page.getByTestId('iv-mode-select')).toHaveValue('iv4q');
    await page.getByTestId('iv-module-id').fill('MOD-A');
    await expect(page.getByTestId('iv-mode-select')).toHaveValue('ivImport');
  });

  for (const mode of MODES) {
    test(`template route /api/iv/${mode.templateSlug}/template responds`, async ({ request }) => {
      const res = await request.get(`/api/iv/${mode.templateSlug}/template`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(mode.expectedContentType);
    });
  }
});
