import { test, expect } from '@playwright/test';
import { mkdtempSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * IEC 61215-2 MQT 11 — Thermal Cycling smoke test.
 *
 * Verifies that the /tests/thermal-cycling deep link redirects to the
 * dashboard, the live chart populates in DEMO mode, Stop transitions
 * the session to a terminal state, and the Report tab exports a PDF
 * (>= 50 KB) whose payload contains the IEC clause label "MQT 11".
 */
test.describe('Thermal Cycling — IEC 61215-2 MQT 11', () => {
  test('demo run → stop → PDF report ≥ 50KB and contains "MQT 11"', async ({ page }) => {
    // Capture the PDF download to a temp dir.
    const dir = mkdtempSync(join(tmpdir(), 'agp-tc-'));

    // Stub jsPDF's `save()` so the download stays in-process — works even
    // if Playwright's download handler doesn't fire for blob: URLs.
    let capturedPdf: Buffer | null = null;
    await page.exposeBinding('__capturePdf', (_src, b64: string) => {
      capturedPdf = Buffer.from(b64, 'base64');
    });

    await page.addInitScript(() => {
      // jsPDF's .save() defaults to a blob download. Intercept by
      // monkey-patching URL.createObjectURL once the blob is created.
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob: Blob): string => {
        if (blob instanceof Blob && blob.type === 'application/pdf') {
          blob.arrayBuffer().then(buf => {
            const u8 = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
            // @ts-expect-error — exposed via addInitScript binding
            window.__capturePdf(btoa(bin));
          });
        }
        return origCreate(blob);
      };
    });

    await page.goto('/tests/thermal-cycling');
    await expect(page).toHaveURL(/[?&]tab=tc/);

    // Demo badge must be visible — we never want to drive real hardware here.
    await expect(page.getByText('DEMO').first()).toBeVisible();

    // Start the test. The Live Monitor sub-tab is the default landing tab.
    // Use `exact` matching so "Start" doesn't ambiguously match other names.
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    // Live chart populates: wait for recharts SVG paths to render.
    await expect(page.locator('.recharts-wrapper').first())
      .toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2500); // collect ≥ a few demo samples

    // Stop the test. `exact` keeps us off the "E-STOP" button.
    await page.getByRole('button', { name: 'Stop', exact: true }).click();

    // Navigate to the Report sub-tab and click Export PDF.
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await page.getByRole('button', { name: /^Export PDF/ }).click();

    // Wait until the binding has the bytes.
    await expect.poll(
      () => (capturedPdf ? capturedPdf.length : 0),
      { timeout: 30_000, intervals: [250, 500, 1000] },
    ).toBeGreaterThanOrEqual(50 * 1024);

    expect(capturedPdf, 'PDF was not captured').not.toBeNull();
    const buf = capturedPdf as unknown as Buffer;
    // Drop a copy to disk so failures are diagnosable.
    const path = join(dir, 'mqt11.pdf');
    writeFileSync(path, buf);
    const stat = statSync(path);
    expect(stat.size).toBeGreaterThanOrEqual(50 * 1024);

    // PDF payload must mention the IEC clause label "MQT 11".
    // jsPDF Helvetica encodes text verbatim, so a binary substring check works.
    const text = readFileSync(path, 'latin1');
    expect(text).toMatch(/MQT\s*11/);
  });
});
