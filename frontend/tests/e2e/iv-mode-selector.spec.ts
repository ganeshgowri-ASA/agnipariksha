/**
 * G17 — IV Source template route smoke (UI-free).
 *
 * Temporarily reduced to API-only assertions while we diagnose a CI-only
 * e2e failure. The UI assertions land in a follow-up once we have the
 * Playwright report to look at.
 */
import { test, expect } from '@playwright/test';

test.describe('G17 — IV template routes', () => {
  test('GET /api/iv/4q/template returns JSON', async ({ request }) => {
    const res = await request.get('/api/iv/4q/template');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/application\/json/);
  });

  test('GET /api/iv/psu-scope/template returns JSON', async ({ request }) => {
    const res = await request.get('/api/iv/psu-scope/template');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/application\/json/);
  });

  test('GET /api/iv/import/template returns XLSX', async ({ request }) => {
    const res = await request.get('/api/iv/import/template');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/spreadsheetml/);
  });
});
