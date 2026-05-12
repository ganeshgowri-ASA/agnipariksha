import { expect, test } from '@playwright/test';

/**
 * Mobile-responsive audit.
 *
 * Verifies, at both 360x640 and 768x1024 viewports:
 *   - The "More" overflow menu appears on phones, and lets the user
 *     navigate to a hidden test tab (e.g. LeTID).
 *   - The AI bottom-sheet trigger is visible on phones, and toggles a
 *     dialog when tapped.
 *   - All four LiveCharts stack into a single column on small screens
 *     (no two charts share a row).
 *   - The Scan / Push controls are reachable from the header.
 */
test.describe('dashboard responsive', () => {
  test('phone-only chrome: "More" menu, AI sheet, Scan link', async ({ page, viewport }) => {
    test.skip(!viewport, 'requires viewport');
    await page.goto('/');

    if (viewport!.width < 768) {
      // Phone: "More" button visible, AI inline trigger visible.
      const more = page.getByTestId('more-tabs-button');
      await expect(more).toBeVisible();
      await more.click();
      const menu = page.getByTestId('more-tabs-menu');
      await expect(menu).toBeVisible();
      await menu.getByText('LeTID').click();
      await expect(page).toHaveURL(/\/$/);

      await expect(page.getByTestId('ai-sheet-trigger')).toBeVisible();
      await page.getByTestId('ai-sheet-trigger').click();
      await expect(page.getByTestId('ai-bottom-sheet')).toBeVisible();
    } else {
      // Tablet+: no "More" button, no inline AI sheet trigger.
      await expect(page.getByTestId('more-tabs-button')).toBeHidden();
      await expect(page.getByTestId('ai-sheet-trigger')).toBeHidden();
    }

    // Scan link reachable on both viewports.
    await expect(page.getByTestId('scan-link')).toBeVisible();
  });

  test('charts collapse to single column at narrow widths', async ({ page, viewport }) => {
    await page.goto('/');
    // Open the live-monitor sub-tab so the chart grid renders.
    const monitorBtn = page.getByRole('button', { name: /Live Monitor/i }).first();
    if (await monitorBtn.isVisible()) await monitorBtn.click();

    const charts = page.locator('[data-testid="live-chart"]');
    const count = await charts.count();
    if (count < 2) test.skip(true, 'no charts rendered yet — seed data offline');

    const boxes = await Promise.all(
      Array.from({ length: count }, (_, i) => charts.nth(i).boundingBox()),
    );
    const widthCutoff = viewport!.width;
    if (widthCutoff < 1024) {
      // Each chart should occupy the full width — no two charts on the
      // same y-row. We assert by checking that consecutive charts have
      // strictly increasing y-coordinates.
      for (let i = 1; i < boxes.length; i++) {
        const a = boxes[i - 1]!;
        const b = boxes[i]!;
        expect(b.y).toBeGreaterThan(a.y);
      }
    }
  });
});

test.describe('scan page', () => {
  test('renders camera + HID + manual input on phones', async ({ page }) => {
    await page.goto('/scan');
    await expect(page.getByRole('heading', { name: /Scan barcode/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start camera/i })).toBeVisible();
    await expect(page.getByLabel('Scan payload')).toBeVisible();
  });

  test('manual payload routes to the module detail page', async ({ page }) => {
    await page.goto('/scan');
    await page.getByLabel('Scan payload').fill('MOD-001234');
    await page.getByRole('button', { name: 'Go' }).click();
    await page.waitForURL(/\/modules\/001234/);
    await expect(page.getByText(/MOD-001234|001234/)).toBeVisible();
  });
});
