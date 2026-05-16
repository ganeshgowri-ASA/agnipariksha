import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Live PSU gate smoke. Verifies that the Thermal Cycling tab's Start
 * button is disabled with a "Basic Check required" tooltip when the
 * backend reports no Basic Check pass, and becomes enabled once the
 * backend says the gate is passed.
 *
 * CRITICAL: this test runs in pure stub mode — no backend, no SCPI
 * client, no PSU output. The router gate behaviour is exercised by
 * backend/tests/test_basic_check.py.
 */

interface GateState {
  passed: boolean;
}

async function installStubs(page: Page, gate: GateState): Promise<void> {
  // Playwright uses the LAST matching route, so register the catch-all
  // first and the specific endpoints afterward so they win.
  await page.route('**/api/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  // /api/health is polled by useHealth — return a generic ok so the lamp
  // tower in Basic Check doesn't go red and trigger unrelated paths.
  await page.route('**/api/health', (route: Route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', backend: { status: 'ok', demo: true, version: 'test' } }),
    }),
  );

  // Basic Check status endpoint — read from the shared `gate` object so a
  // single test can flip the gate mid-flight.
  await page.route('**/api/basic-check/status**', (route: Route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        module_id: 'tc',
        passed: gate.passed,
        age_s: gate.passed ? 5 : -1,
        ttl_s: 3600,
        expires_in_s: gate.passed ? 3595 : null,
        passed_at: gate.passed ? new Date().toISOString() : null,
        run_id: gate.passed ? 'bc-tc-test' : null,
      }),
    }),
  );

  // Accept POST /api/basic-check/pass silently so the Basic Check sub-tab's
  // "post pass on green" effect doesn't blow up in the console.
  await page.route('**/api/basic-check/pass', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"passed":true}' }),
  );
}

test('Start button blocked with tooltip until Basic Check passes', async ({ page }) => {
  const gate: GateState = { passed: false };
  await installStubs(page, gate);

  await page.goto('/dashboard?tab=tc');

  // The TC tab defaults to the Basic Check sub-tab; the control bar lives
  // in the test header above it. Start is disabled and carries the tooltip.
  const startBtn = page.getByTestId('control-start');
  await expect(startBtn).toBeVisible();
  await expect(startBtn).toBeDisabled();
  await expect(startBtn).toHaveAttribute('title', /Basic Check required/i);

  // Flip the stub and wait for the polling hook to pick it up. The hook
  // re-polls every 10s; we shorten the wait by directly POSTing the pass
  // endpoint which our route handler already accepts.
  gate.passed = true;

  // Force a refresh by waiting for the next poll tick (the hook polls
  // /api/basic-check/status every 10s; we wait up to 15s).
  await expect(startBtn).toBeEnabled({ timeout: 15_000 });
  await expect(startBtn).not.toHaveAttribute('title', /Basic Check required/i);
});
