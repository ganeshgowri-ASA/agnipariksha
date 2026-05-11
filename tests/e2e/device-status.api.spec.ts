import { test, expect } from '@playwright/test';

/**
 * Contract smoke for /api/device/status.
 * We mock the backend with page.route() and assert that the frontend
 * consumes the documented shape: { connected, model, ip, port, … }.
 */

test('frontend consumes /api/device/status JSON shape', async ({ page }) => {
  let captured: Record<string, unknown> | null = null;

  await page.route('**/api/device/status', async (route) => {
    const payload = {
      connected: true,
      model: 'ITECH PV6000',
      ip: '192.168.200.100',
      port: 30000,
      firmware: 'IT9000 v1.0.3.3',
      demo_mode: false,
    };
    captured = payload;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  await page.goto('/');

  // Give the client a moment to issue the request.
  await page.waitForLoadState('networkidle');

  expect(captured, '/api/device/status was never requested').not.toBeNull();
  expect(captured).toMatchObject({
    connected: expect.any(Boolean),
    model: expect.any(String),
    ip: expect.any(String),
    port: expect.any(Number),
  });
});
