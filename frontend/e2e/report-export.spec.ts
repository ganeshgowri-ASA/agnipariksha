import { test, expect } from '@playwright/test';

/**
 * Session 1 regression — Export PDF / Word on the Report sub-tab must work
 * in DEMO_MODE without a live run.
 *
 * Before the fix the buttons were `disabled` whenever no TestSession
 * existed (the normal demo path, since a session is only created on Start),
 * so clicking produced zero response. The shared ReportGenerator now
 * resolves a synthetic demo session, enabling export everywhere.
 */
test('Report tab exports a PDF in demo mode (download + sample data)', async ({ page }) => {
  await page.goto('/dashboard');

  // TC is the default tab; open its Report sub-tab.
  await page.getByTestId('subtab-report').click();

  // The synthetic demo session is in use, so the summary + SAMPLE DATA chip
  // render and both export buttons are enabled (the regression: they used
  // to be disabled because `session` was null).
  await expect(page.getByTestId('report-sample-data')).toBeVisible();
  const pdfBtn = page.getByTestId('export-pdf-btn');
  await expect(pdfBtn).toBeEnabled();
  await expect(page.getByTestId('export-word-btn')).toBeEnabled();

  // Clicking Export PDF produces a real .pdf download.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    pdfBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});
