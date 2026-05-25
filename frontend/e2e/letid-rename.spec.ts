/**
 * P1 — LID → LeTID rename (IEC TS 63342).
 *
 *   1. The dashboard test rail shows the renamed "LeTID" tab.
 *   2. The legacy /lid path 308-redirects to the new /letid segment so
 *      existing links keep working.
 */
import { test, expect } from '@playwright/test';

test('test rail shows the renamed LeTID tab', async ({ page }) => {
  await page.goto('/dashboard');
  const tab = page.getByTestId('dashboard-tab-letid');
  await expect(tab).toBeVisible();
  await expect(tab).toContainText('LeTID');
});

test('GET /lid returns a 308 permanent redirect to /letid', async ({ request }) => {
  const res = await request.get('/lid', { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()['location']).toMatch(/\/letid$/);
});
