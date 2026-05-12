import { expect, test } from '@playwright/test';

/**
 * Smoke test for IEC 61215-2 MQT 12 Humidity Freeze tab.
 *
 * The backend HTTP surface is mocked so the test can run without a
 * running FastAPI process. We verify:
 *   1. The /tests/humidity-freeze slug redirects to the HF tab
 *   2. The Figure 9 envelope chart renders
 *   3. Pressing Start triggers a run that paints the PASS verdict
 */
test.describe('Humidity Freeze (MQT 12)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/tests/humidity-freeze/profile', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          iec_clause: 'IEC 61215-2:2021 clause 4.12 (MQT 12)',
          cycles: 2,
          bias_current_a: 0.1,
          cycle_duration_s: 72_000,
          profile: Array.from({ length: 20 }).map((_, i) => ({
            t_s: i * 30,
            cycle: 1 + Math.floor(i / 10),
            phase: ['hot_dwell', 'ramp_down', 'cold_dwell', 'ramp_up'][i % 4],
            T: 85 - (i * 6),
            RH: Math.max(0, 85 - i * 4),
            I: 0.1,
          })),
        }),
      });
    });

    await page.route('**/api/tests/humidity-freeze/run', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'pw-smoke',
          verdict: 'PASS',
          reasons: [],
          iec_clause: 'IEC 61215-2:2021 clause 4.12 (MQT 12)',
          raw_csv_path: '/tmp/hf_pw.csv',
          cycle_log: [
            { cycle: 1, hot_dwell_s: 72000, cold_dwell_s: 1800,
              ramp_down_rate_c_per_h: 180, ramp_up_rate_c_per_h: 90,
              hot_in_tol: true, cold_in_tol: true },
            { cycle: 2, hot_dwell_s: 72000, cold_dwell_s: 1800,
              ramp_down_rate_c_per_h: 178, ramp_up_rate_c_per_h: 88,
              hot_in_tol: true, cold_in_tol: true },
          ],
          ramp_violations: [],
          dwell_checks: [],
          mqt01_visual_pass: true,
          mqt15_wet_leakage_pass: true,
        }),
      });
    });

    await page.route('**/api/tests/**/control', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json',
                            body: JSON.stringify({ accepted: true }) });
    });
  });

  test('slug routes to the HF tab and renders Figure 9', async ({ page }) => {
    await page.goto('/tests/humidity-freeze');
    await expect(page).toHaveURL(/\/\?tab=hf/);
    await expect(page.getByText(/IEC 61215-2 MQT 12/i).first()).toBeVisible();
    // The setup panel pre-fetches the profile envelope on mount.
    await expect(page.getByTestId('hf-profile-chart')).toBeVisible();
  });

  test('Start posts a run and surfaces the PASS verdict + cycle log',
    async ({ page }) => {
      await page.goto('/?tab=hf');
      await page.getByRole('button', { name: /^Start$/i }).click();
      const verdict = page.getByTestId('hf-verdict');
      await expect(verdict).toHaveText('PASS', { timeout: 10_000 });
      // Cycle log table contains two rows of cycle data.
      await expect(page.getByTestId('hf-run-result')).toContainText('1');
      await expect(page.getByTestId('hf-run-result')).toContainText('2');
    });
});
