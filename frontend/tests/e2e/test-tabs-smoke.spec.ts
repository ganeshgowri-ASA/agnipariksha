/**
 * QA harness — tab-level smoke for the dashboard.
 *
 * Validates that every operator-facing view renders without throwing:
 *
 *   Per IEC test tab (TC, HF, LeTID, BDT, RCO, GCT, DH):
 *     - Setup
 *     - Live Monitor
 *     - Data Table
 *     - Analysis
 *     - Report
 *     - Basic Check (TC only — only tab that exposes the preflight sub-tab)
 *
 *   Plus:
 *     - Overview (top-level /overview landing page)
 *
 * These tests are demo-mode only (no backend WebSocket required). They
 * intentionally avoid asserting on dynamic data; the goal is to catch
 * render-blocking regressions in any sub-tab, not validate analytics
 * output (that is covered by backend/tests/test_analysis.py).
 */
import { test, expect, type Page } from '@playwright/test';

interface IecTab {
  key: 'tc' | 'hf' | 'letid' | 'bdt' | 'rco' | 'gct' | 'dh';
  name: string;
  hasBasicCheck: boolean;
}

const IEC_TABS: IecTab[] = [
  { key: 'tc',    name: 'Thermal Cycling',          hasBasicCheck: true  },
  { key: 'hf',    name: 'Humidity Freeze',          hasBasicCheck: false },
  { key: 'letid', name: 'LeTID',                    hasBasicCheck: false },
  { key: 'bdt',   name: 'Bypass Diode Thermal',     hasBasicCheck: false },
  { key: 'rco',   name: 'Reverse Current Overload', hasBasicCheck: false },
  { key: 'gct',   name: 'Ground Continuity',        hasBasicCheck: false },
  { key: 'dh',    name: 'Damp Heat',                hasBasicCheck: false },
];

async function openIecTab(page: Page, key: IecTab['key']): Promise<void> {
  await page.goto(`/dashboard?tab=${key}`);
  await expect(page.getByTestId(`test-tab-${key}`)).toBeVisible({ timeout: 15_000 });
}

async function selectSubTab(page: Page, subKey: string): Promise<void> {
  const trigger = page.getByTestId(`subtab-${subKey}`);
  await expect(trigger, `sub-tab ${subKey} trigger`).toBeVisible();
  await trigger.click();
  await expect(page.getByTestId(`subtab-pane-${subKey}`), `pane ${subKey}`).toBeVisible();
}

test.describe('tab-level smoke — Setup', () => {
  for (const tab of IEC_TABS) {
    test(`${tab.key.toUpperCase()} → Setup renders`, async ({ page }) => {
      await openIecTab(page, tab.key);
      await selectSubTab(page, 'setup');
    });
  }
});

test.describe('tab-level smoke — Live Monitor', () => {
  for (const tab of IEC_TABS) {
    test(`${tab.key.toUpperCase()} → Live Monitor renders`, async ({ page }) => {
      await openIecTab(page, tab.key);
      await selectSubTab(page, 'monitor');
    });
  }
});

test.describe('tab-level smoke — Data Table', () => {
  for (const tab of IEC_TABS) {
    test(`${tab.key.toUpperCase()} → Data Table renders`, async ({ page }) => {
      await openIecTab(page, tab.key);
      await selectSubTab(page, 'data');
    });
  }
});

test.describe('tab-level smoke — Analysis', () => {
  for (const tab of IEC_TABS) {
    test(`${tab.key.toUpperCase()} → Analysis renders`, async ({ page }) => {
      await openIecTab(page, tab.key);
      await selectSubTab(page, 'analysis');
    });
  }
});

test.describe('tab-level smoke — Report', () => {
  for (const tab of IEC_TABS) {
    test(`${tab.key.toUpperCase()} → Report renders`, async ({ page }) => {
      await openIecTab(page, tab.key);
      await selectSubTab(page, 'report');
    });
  }
});

test.describe('tab-level smoke — Basic Check', () => {
  for (const tab of IEC_TABS) {
    if (!tab.hasBasicCheck) {
      test(`${tab.key.toUpperCase()} has no Basic Check sub-tab`, async ({ page }) => {
        await openIecTab(page, tab.key);
        await expect(page.getByTestId('subtab-basic-check')).toHaveCount(0);
      });
      continue;
    }
    test(`${tab.key.toUpperCase()} → Basic Check renders + gate lamp`, async ({ page }) => {
      await openIecTab(page, tab.key);
      await selectSubTab(page, 'basic-check');
      // Status tower lamps + the operator gate marker should both be present.
      await expect(page.getByTestId('status-tower')).toBeVisible();
      await expect(page.getByTestId('basic-check-gate')).toBeAttached();
    });
  }
});

test.describe('tab-level smoke — Overview', () => {
  test('Overview renders all six cards', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByTestId('overview-root')).toBeVisible();
    for (const id of [
      'overview-card-kpis',
      'overview-card-equipment',
      'overview-card-schedule',
      'overview-card-tickets',
      'overview-card-spares',
      'overview-card-ai',
    ]) {
      await expect(page.getByTestId(id), `card ${id}`).toBeVisible();
    }
  });
});
