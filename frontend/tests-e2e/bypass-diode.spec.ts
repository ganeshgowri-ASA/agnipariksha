import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * MQT 18 Bypass Diode — full Phase A + B + C in DEMO accelerated mode.
 *
 * Asserts:
 *   1. The Tj card renders after the run completes.
 *   2. A PDF is generated and is >= 80 KB.
 *   3. The PDF contains the strings 'MQT 18' and 'Tj'.
 */

test('runs Phase A+B+C and generates an MQT 18 PDF report', async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  await page.goto('/?tab=bdt');

  // Setup defaults are fine, but make sure the diode dropdown is populated by waiting
  // for the catalog fetch to settle.
  await expect(page.getByTestId('bdt-part')).toBeVisible();

  // Kick the run.
  await page.getByTestId('bdt-start').click();

  // The websocket-driven state machine moves through phases; the analysis tab
  // is auto-selected when 'result' arrives. Wait for the verdict card.
  await expect(page.getByTestId('bdt-verdict-card')).toBeVisible({ timeout: 45_000 });

  // Go to the report tab.
  await page.getByTestId('bdt-tab-report').click();

  // Capture the download triggered by the PDF generation.
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('bdt-generate-pdf').click();
  const download = await downloadPromise;

  const target = path.join(testInfo.outputDir, 'mqt18-bypass.pdf');
  await download.saveAs(target);

  const stat = fs.statSync(target);
  expect(stat.size).toBeGreaterThanOrEqual(80 * 1024);

  // PDF text content -> a lightweight substring scan over the raw bytes is enough
  // for the smoke check. The strings appear as plain ASCII in the stream because
  // jsPDF embeds Helvetica with WinAnsi encoding.
  const buf = fs.readFileSync(target, 'latin1');
  expect(buf).toContain('MQT 18');
  expect(buf).toContain('Tj');
});
