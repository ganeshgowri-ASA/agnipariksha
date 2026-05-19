import { test, expect } from '@playwright/test';

// Procurement endpoints are mocked client-side by MSW (frontend/mocks/).
// The seed is deterministic, so these counts and IDs are stable across runs.
//
// The browser worker installs from /overview after the React tree mounts,
// so we navigate there once and reuse the page for all fetches in a test.

async function gotoApp(page: import('@playwright/test').Page) {
  await page.goto('/overview');
  await expect(page.getByTestId('overview-root')).toBeVisible();
  // MswProvider boots the worker asynchronously after mount; wait for the
  // ready flag before issuing any fetch so we don't race the SW take-over.
  await page.waitForFunction(
    () => (window as unknown as { __MSW_READY?: boolean }).__MSW_READY === true,
    null,
    { timeout: 15_000 },
  );
  // Reset between tests so mutations from a prior test don't bleed in.
  await page.evaluate(async () => {
    await fetch('/api/procurement/__reset', { method: 'POST' });
  });
}

test('GET /api/procurement/vendor returns the seeded 12 vendors', async ({ page }) => {
  await gotoApp(page);
  const body = await page.evaluate(async () => {
    const r = await fetch('/api/procurement/vendor?page_size=100');
    return r.json();
  });
  expect(body.total).toBe(12);
  expect(body.items[0].id).toBe('VND-001');
});

test('GET /api/procurement/rfq returns 50 RFQs deterministically', async ({ page }) => {
  await gotoApp(page);
  const body = await page.evaluate(async () => {
    const r = await fetch('/api/procurement/rfq?page_size=100');
    return r.json();
  });
  expect(body.total).toBe(50);
  const ids: string[] = body.items.map((r: { id: string }) => r.id);
  expect(ids).toContain('RFQ-2026-0001');
  expect(ids).toContain('RFQ-2026-0050');
});

test('GET /api/procurement/po returns 30 POs deterministically', async ({ page }) => {
  await gotoApp(page);
  const body = await page.evaluate(async () => {
    const r = await fetch('/api/procurement/po?page_size=100');
    return r.json();
  });
  expect(body.total).toBe(30);
  const ids: string[] = body.items.map((p: { id: string }) => p.id);
  expect(ids).toContain('PO-2026-0001');
  expect(ids).toContain('PO-2026-0030');
});

test('POST + GET RFQ round-trip persists in the worker', async ({ page }) => {
  await gotoApp(page);
  const created = await page.evaluate(async () => {
    const r = await fetch('/api/procurement/rfq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'E2E RFQ probe',
        priority: 'high',
        requestor: 'e2e-bot',
        cost_center: 'CC-QA',
        vendor_ids: ['VND-001'],
        lines: [
          { sku: 'TC-K-1M', description: 'Type-K probe', quantity: 4, unit: 'ea' },
        ],
      }),
    });
    return { status: r.status, body: await r.json() };
  });
  expect(created.status).toBe(201);
  expect(created.body.id).toMatch(/^RFQ-2026-\d{4}$/);
  expect(created.body.priority).toBe('high');

  const fetched = await page.evaluate(async (id: string) => {
    const r = await fetch(`/api/procurement/rfq/${id}`);
    return { status: r.status, body: await r.json() };
  }, created.body.id);
  expect(fetched.status).toBe(200);
  expect(fetched.body.title).toBe('E2E RFQ probe');
});

test('POST PO with unknown vendor returns 422', async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(async () => {
    const r = await fetch('/api/procurement/po', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor_id: 'VND-DOES-NOT-EXIST',
        lines: [{ sku: 'X', quantity: 1, unit_price: 10 }],
      }),
    });
    return { status: r.status, body: await r.json() };
  });
  expect(result.status).toBe(422);
  expect(result.body.error).toMatch(/vendor/i);
});
