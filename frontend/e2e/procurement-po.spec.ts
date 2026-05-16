import { test, expect, type Page, type Route } from '@playwright/test';

type POStatus =
  | 'draft'
  | 'issued'
  | 'acknowledged'
  | 'shipped'
  | 'received'
  | 'closed'
  | 'cancelled';

type PO = {
  id: string;
  po_number: string;
  vendor: string;
  rfq_ref: string | null;
  total: number;
  currency: string;
  status: POStatus;
  eta: string | null;
  created_at: number;
  updated_at: number;
};

function makePOs(n: number): PO[] {
  const out: PO[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `po-${i}`,
      po_number: `PO-2026-${String(i).padStart(4, '0')}`,
      vendor: `Vendor ${i}`,
      rfq_ref: i % 5 === 0 ? null : `RFQ-2026-${String(i).padStart(3, '0')}`,
      total: 1000 + i * 25,
      currency: 'INR',
      status: (
        ['draft', 'issued', 'acknowledged', 'shipped', 'received', 'closed', 'cancelled'] as POStatus[]
      )[i % 7],
      eta: i % 3 === 0 ? null : '2026-06-30',
      created_at: 1_700_000_000 - i,
      updated_at: 1_700_000_000 - i,
    });
  }
  return out;
}

async function installStub(page: Page, total: number): Promise<void> {
  const all = makePOs(total);
  await page.route('**/api/procurement/po*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/api/procurement/po')) return route.continue();
    const p = parseInt(url.searchParams.get('page') ?? '1', 10);
    const s = parseInt(url.searchParams.get('size') ?? '25', 10);
    const start = (p - 1) * s;
    const items = all.slice(start, start + s);
    const pages = Math.ceil(all.length / s);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: all.length, page: p, size: s, pages }),
    });
  });
}

test.describe('/procurement/po', () => {
  test('renders the table with the required columns', async ({ page }) => {
    await installStub(page, 5);
    await page.goto('/procurement/po');

    await expect(page.getByTestId('po-table')).toBeVisible();
    const headers = page.getByTestId('po-table').locator('thead th');
    await expect(headers).toHaveText([
      'PO #',
      'Vendor',
      'RFQ Ref',
      'Total',
      'Status',
      'ETA',
    ]);
    await expect(page.getByTestId('po-row')).toHaveCount(5);
  });

  test('paginates with prev/next and respects total', async ({ page }) => {
    await installStub(page, 60);
    await page.goto('/procurement/po');

    // Default size = 25 → 3 pages of 60 rows.
    await expect(page.getByTestId('po-page-indicator')).toHaveText('Page 1 of 3');
    await expect(page.getByTestId('po-row')).toHaveCount(25);
    await expect(page.getByTestId('po-prev')).toBeDisabled();

    await page.getByTestId('po-next').click();
    await expect(page.getByTestId('po-page-indicator')).toHaveText('Page 2 of 3');
    await expect(page.getByTestId('po-row')).toHaveCount(25);

    await page.getByTestId('po-next').click();
    await expect(page.getByTestId('po-page-indicator')).toHaveText('Page 3 of 3');
    await expect(page.getByTestId('po-row')).toHaveCount(10);
    await expect(page.getByTestId('po-next')).toBeDisabled();

    await page.getByTestId('po-prev').click();
    await expect(page.getByTestId('po-page-indicator')).toHaveText('Page 2 of 3');
  });

  test('changing page size resets to page 1', async ({ page }) => {
    await installStub(page, 60);
    await page.goto('/procurement/po');

    await page.getByTestId('po-next').click();
    await expect(page.getByTestId('po-page-indicator')).toHaveText('Page 2 of 3');

    await page.getByTestId('po-page-size').selectOption('10');
    await expect(page.getByTestId('po-page-indicator')).toHaveText('Page 1 of 6');
    await expect(page.getByTestId('po-row')).toHaveCount(10);
  });

  test('shows empty state when there are no POs', async ({ page }) => {
    await installStub(page, 0);
    await page.goto('/procurement/po');
    await expect(page.getByTestId('state-empty')).toBeVisible();
    await expect(page.getByTestId('po-summary')).toHaveText('No purchase orders');
  });
});
