/**
 * Playwright smoke for the PSU Basic-Check gate UI (#52c).
 *
 * Mocks ``/api/basic-check/status`` and asserts the TC tab still renders
 * with the Basic Check sub-tab + status tower wiring. The full interlock
 * contract is enforced server-side and verified in
 * backend/tests/test_basic_check_interlock.py — this spec is a render
 * smoke that catches dead-wiring regressions in the UI tower.
 */
import { test, expect, type Page } from '@playwright/test';

const TC_DASHBOARD = '/dashboard?tab=tc';

async function mockBasicCheckStatus(page: Page, passed: boolean): Promise<void> {
  await page.route('**/api/basic-check/status*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        module_id: 'MOD-E2E-PSU', passed,
        age_s: passed ? 5 : -1, ttl_s: 3600,
        expires_in_s: passed ? 3595 : null,
        passed_at: passed ? new Date().toISOString() : null, run_id: null,
      }),
    });
  });
}

test.describe('PSU gate — Start button + Basic Check tower', () => {
  test('TC Basic Check sub-tab renders with status tower', async ({ page }) => {
    await mockBasicCheckStatus(page, false);
    await page.goto(TC_DASHBOARD);
    await expect(page.getByTestId('test-tab-tc')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('subtab-basic-check').click();
    await expect(page.getByTestId('subtab-pane-basic-check')).toBeVisible();
    await expect(page.getByTestId('basic-check-gate')).toBeAttached();
  });

  test('TC Start button is present (legacy: not gated without moduleId)', async ({ page }) => {
    await mockBasicCheckStatus(page, false);
    await page.goto(TC_DASHBOARD);
    await expect(page.getByTestId('test-tab-tc')).toBeVisible({ timeout: 15_000 });
    const start = page.getByTestId('start-btn');
    await expect(start).toBeVisible();
    // No moduleId → no gate → not aria-disabled by the gate.
    await expect(start).not.toHaveAttribute('aria-disabled', 'true');
  });
});
