import { test, expect } from '@playwright/test';

test('module ID entered in TC Setup tab is visible in HF Setup tab', async ({ page }) => {
  await page.goto('/dashboard');

  // TC tab is the default. Switch to its Setup sub-tab.
  await page.getByRole('button', { name: /Setup/ }).first().click();

  // Type a valid demo module ID and submit with Enter so the store updates.
  const tcInput = page.getByTestId('module-id-input');
  await expect(tcInput).toBeVisible();
  await tcInput.fill('MOD-2026-001');
  await tcInput.press('Enter');

  // The /api/modules/MOD-2026-001 proxy resolves to the seeded
  // demo catalogue (Vikram Solar) even without the FastAPI backend
  // running, so the nameplate row should appear.
  await expect(page.getByTestId('module-id-status-valid')).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId('module-nameplate')).toContainText('Vikram Solar');

  // Switch to the HF (Humidity Freeze) test tab.
  await page.getByRole('tab', { name: /Humidity Freeze|HF/ }).click();
  await page.getByRole('button', { name: /Setup/ }).first().click();

  // The shared zustand store hydrates the HF Setup tab with the same ID.
  await expect(page.getByTestId('module-id-input')).toHaveValue('MOD-2026-001');
  await expect(page.getByTestId('module-id-status-valid')).toBeVisible();
});

test('unknown module ID shows invalid status without breaking the form', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Setup/ }).first().click();

  const input = page.getByTestId('module-id-input');
  await input.fill('UNKNOWN-MODULE-XYZ');
  await input.press('Enter');

  await expect(page.getByTestId('module-id-status-invalid')).toBeVisible({
    timeout: 5_000,
  });
  // Nameplate panel must not render for an invalid ID.
  await expect(page.getByTestId('module-nameplate')).toHaveCount(0);
});
