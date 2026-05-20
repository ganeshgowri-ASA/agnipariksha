import { test, expect } from '@playwright/test';

/**
 * G12 — Report-tab section checkboxes persist per Module ID.
 *
 * We navigate into the Thermal Cycling tab → Report sub-tab, untick the
 * "Photos" section for module "MOD-A", switch to module "MOD-B" and
 * confirm "Photos" is back to its default (checked), then return to
 * "MOD-A" and confirm the unticked state was remembered.
 */
test('report section checkboxes persist per Module ID', async ({ page }) => {
  await page.goto('/dashboard');

  // TC tab is the default active tab on /dashboard, but the sub-tab
  // defaults to Basic Check (because TC supplies a basicCheckPanel).
  // Click the Report sub-tab inside the active TC panel. PR #51 gave the
  // sub-tab buttons role="tab", so we anchor on the stable testid emitted
  // by TestTabLayout rather than `getByRole('button')`.
  await page.getByTestId('subtab-report').click();

  const sectionsPanel = page.getByTestId('report-sections-panel');
  await expect(sectionsPanel).toBeVisible();

  // All seven section checkboxes render.
  for (const key of ['cover', 'setup', 'telemetry', 'analysis', 'photos', 'appendix', 'iec_clauses']) {
    await expect(page.getByTestId(`report-section-${key}`)).toBeVisible();
  }

  // Enter module A and untick Photos.
  await page.getByTestId('report-module-id').fill('MOD-A');
  // Force a blur so useEffect on moduleId runs before we toggle.
  await page.getByTestId('report-module-id').blur();
  const photos = page.getByTestId('report-section-photos');
  await expect(photos).toBeChecked();
  await photos.uncheck();
  await expect(photos).not.toBeChecked();

  // Switch to module B — Photos should bounce back to the default (checked).
  await page.getByTestId('report-module-id').fill('MOD-B');
  await page.getByTestId('report-module-id').blur();
  await expect(page.getByTestId('report-section-photos')).toBeChecked();

  // Switch back to module A — Photos should still be unchecked.
  await page.getByTestId('report-module-id').fill('MOD-A');
  await page.getByTestId('report-module-id').blur();
  await expect(page.getByTestId('report-section-photos')).not.toBeChecked();

  // Reload and verify persistence survives a full page reload.
  await page.reload();
  await page.getByTestId('subtab-report').click();
  await page.getByTestId('report-module-id').fill('MOD-A');
  await page.getByTestId('report-module-id').blur();
  await expect(page.getByTestId('report-section-photos')).not.toBeChecked();
});
