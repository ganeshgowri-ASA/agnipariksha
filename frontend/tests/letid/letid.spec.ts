/**
 * /tests/letid page smoke tests.
 *
 * These tests intercept the backend network calls so they run without a
 * live FastAPI server — focus is on the UI contract (form bindings,
 * event-log updates, results panel rendering, clause references).
 *
 * A separate end-to-end target with the real backend can be added later
 * once a CI service spins both processes.
 */
import { test, expect, type Route } from '@playwright/test';

const BACKEND = 'http://localhost:8000';

test.describe('/tests/letid', () => {
  test.beforeEach(async ({ page }) => {
    // Stub HTTP endpoints — start returns a session id, stop returns a summary.
    await page.route(`${BACKEND}/api/tests/letid/start`, async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ session_id: 'LETID-test-1', started: true }),
      });
    });
    await page.route(/\/api\/tests\/letid\/.*\/stop/, async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'LETID-test-1', stopped: true,
          summary: {
            session_id: 'LETID-test-1',
            passed: true,
            max_relative_loss_pct: 1.2,
            time_to_min_h: 36.0,
            regeneration_fraction: 0.45,
            final_dose_sun_h: 162.0,
            final_elapsed_h: 162.0,
            n_iv_points: 8,
            n_env_samples: 1024,
            csv_path: 'data/letid/LETID-test-1/iv_log.csv',
            report_path: 'data/letid/LETID-test-1/report.json',
            fit: {
              p0: 333.75, amp_degrade: 0.022, tau_degrade_h: 30.0,
              amp_regen: 0.012, tau_regen_h: 90.0, rmse: 0.05, n_points: 8,
            },
            notes: [],
          },
        }),
      });
    });
    await page.route(/\/api\/tests\/letid\/.*\/(pause|resume)/, async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  });

  test('renders setup form with IEC TS 63342 defaults', async ({ page }) => {
    await page.goto('/tests/letid');
    await expect(page.getByTestId('letid-title')).toContainText('IEC TS 63342');
    await expect(page.getByTestId('field-total_duration_h')).toHaveValue('162');
    await expect(page.getByTestId('field-iv_interval_h')).toHaveValue('24');
    await expect(page.getByTestId('field-temperature_c')).toHaveValue('75');
    await expect(page.getByTestId('field-max_allowed_loss_pct')).toHaveValue('2');
  });

  test('lists IEC TS 63342 clause references', async ({ page }) => {
    await page.goto('/tests/letid');
    const clauses = page.getByTestId('clauses');
    await expect(clauses).toContainText('§6.2');
    await expect(clauses).toContainText('§6.3');
    await expect(clauses).toContainText('§6.4');
    await expect(clauses).toContainText('§7.2');
    await expect(clauses).toContainText('Annex A');
  });

  test('start populates session id and unlocks pause/resume/stop', async ({ page }) => {
    await page.goto('/tests/letid');
    const start = page.getByTestId('start-btn');
    const stop  = page.getByTestId('stop-btn');
    const pause = page.getByTestId('pause-btn');

    await expect(stop).toBeDisabled();
    await expect(pause).toBeDisabled();

    await start.click();

    await expect(page.getByTestId('session-id')).toContainText('LETID-test-1');
    await expect(stop).toBeEnabled();
    await expect(pause).toBeEnabled();
    await expect(page.getByTestId('event-log')).toContainText('started LETID-test-1');
  });

  test('stop populates results panel with verdict + fit parameters', async ({ page }) => {
    await page.goto('/tests/letid');
    await page.getByTestId('start-btn').click();
    await page.getByTestId('stop-btn').click();
    const results = page.getByTestId('results-panel');
    await expect(results).toBeVisible();
    await expect(results).toContainText('PASS');
    await expect(results).toContainText('1.200 %');
    await expect(results).toContainText('30.00'); // tau_degrade_h
    await expect(results).toContainText('iv_log.csv');
  });
});
