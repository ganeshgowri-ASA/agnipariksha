/**
 * Smoke — Tab 5 IEC report.
 *
 * CI runs Playwright against a dead backend port, so this asserts the page
 * degrades gracefully: the run selector falls back to the demo run id and
 * the PDF/HTML links still point at the report endpoints.
 */
import { test, expect } from '@playwright/test';

test.describe('Reports — Tab 5 IEC report', () => {
  test('/reports renders the run selector and report links', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByTestId('reports-root')).toBeVisible({ timeout: 15_000 });

    // Selector always renders ≥1 run (live list, or the demo fallback offline).
    const select = page.getByTestId('reports-run-select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).not.toHaveCount(0);

    // Links target the backend report endpoints for the selected run.
    const pdf = page.getByTestId('reports-pdf-link');
    await expect(pdf).toHaveAttribute('href', /\/api\/reports\/.+\.pdf$/);

    // The HTML twin is embedded as an iframe.
    await expect(page.getByTestId('reports-iframe')).toBeVisible();
  });
});
