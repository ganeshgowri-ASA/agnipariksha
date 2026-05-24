import { test, expect } from '@playwright/test';

// DEMO-only smoke for the EL workspace (IEC TS 60904-13). Asserts the Setup
// form fields render; capture/analysis use synthetic frames and IndexedDB.
test('EL workspace Setup form renders', async ({ page }) => {
  await page.goto('/el');
  await expect(page.getByTestId('el-workspace')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('el-pane-setup')).toBeVisible();
  await expect(page.getByTestId('el-camera')).toBeVisible();
  await expect(page.getByTestId('el-setpoint')).toBeVisible();
  await expect(page.getByTestId('el-exposure')).toBeVisible();
  await expect(page.getByTestId('el-gain')).toBeVisible();
  await expect(page.getByTestId('el-recipe-name')).toBeVisible();
  await expect(page.getByTestId('el-capture')).toBeVisible();
});
