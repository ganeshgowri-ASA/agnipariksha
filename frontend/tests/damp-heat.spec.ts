import { test, expect } from '@playwright/test';

/**
 * Playwright e2e for IEC 61215-2 MQT 13 — Damp Heat.
 *
 * The Next.js route `/tests/damp-heat` redirects to `/?tab=dh`, which
 * mounts <DampHeatTab/>. We stub the FastAPI `/api/tests/damp-heat/run`
 * endpoint so the spec does not require the Python backend to be up.
 */

const FAKE_REPORT_PASS = {
  session_id: 'DH-deadbeef',
  test: 'Damp Heat',
  standard: 'IEC 61215-2 MQT 13',
  iec_clause: 'IEC 61215-2:2021 clause 4.13 (MQT 13 — Damp Heat)',
  result: 'PASS',
  raw_csv_path: '/tmp/logs/damp_heat/DH-deadbeef.csv',
  config: {},
  timeline: [],
  analysis: {
    samples: 60_000,
    in_tolerance_samples: 59_900,
    in_tolerance_fraction: 0.9983,
    in_tolerance_duration_h: 998.3,
    total_duration_h: 1000.0,
    duration_pass: true,
    temp_excursions: 50,
    rh_excursions: 50,
    pmax_loss_pct: 1.5,
    gate2: {
      name: 'Gate 2 — Pmax retention',
      clause: 'IEC 61215-1 §8 Gate 2',
      status: 'pass',
      detail: 'Pmax loss = +1.50 % (limit ≤ 5.0 %)',
    },
    mqt01: {
      name: 'MQT 01 — Visual inspection',
      clause: 'IEC 61215-2 clause 4.1',
      status: 'pass',
      detail: 'No major visual defects logged.',
    },
    mqt15: {
      name: 'MQT 15 — Wet leakage / insulation',
      clause: 'IEC 61215-2 clause 4.15',
      status: 'pass',
      detail: 'Insulation = 120.0 MΩ (limit ≥ 40 MΩ).',
    },
    overall: 'pass',
  },
};

const FAKE_REPORT_FAIL = {
  ...FAKE_REPORT_PASS,
  session_id: 'DH-cafebabe',
  result: 'FAIL',
  analysis: {
    ...FAKE_REPORT_PASS.analysis,
    pmax_loss_pct: 12.0,
    gate2: {
      ...FAKE_REPORT_PASS.analysis.gate2,
      status: 'fail',
      detail: 'Pmax loss = +12.00 % (limit ≤ 5.0 %)',
    },
    overall: 'fail',
  },
};

test.describe('IEC 61215-2 MQT 13 — Damp Heat', () => {
  test('redirects /tests/damp-heat to the DH tab and renders the setup panel', async ({ page }) => {
    await page.goto('/tests/damp-heat');
    await page.waitForURL(/[?&]tab=dh\b/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /IEC 61215-2 MQT 13/ })).toBeVisible();
    await expect(page.getByTestId('damp-heat-report-panel')).toBeVisible();
  });

  test('generates a PASS report when Gate-2 is within tolerance', async ({ page }) => {
    await page.route('**/api/tests/damp-heat/run', route =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(FAKE_REPORT_PASS) }),
    );
    await page.goto('/tests/damp-heat');
    await page.waitForURL(/[?&]tab=dh\b/);
    await page.getByTestId('damp-heat-generate-report').click();
    const result = page.getByTestId('damp-heat-report-result');
    await expect(result).toBeVisible();
    await expect(page.getByTestId('damp-heat-report-result-label')).toHaveText('PASS');
    await expect(result).toContainText('IEC 61215-2:2021 clause 4.13');
    await expect(result).toContainText('DH-deadbeef.csv');
    await expect(result).toContainText('Pmax loss');
  });

  test('shows FAIL state when Gate-2 power loss exceeds the limit', async ({ page }) => {
    await page.route('**/api/tests/damp-heat/run', route =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(FAKE_REPORT_FAIL) }),
    );
    await page.goto('/tests/damp-heat');
    await page.waitForURL(/[?&]tab=dh\b/);
    await page.getByTestId('damp-heat-generate-report').click();
    await expect(page.getByTestId('damp-heat-report-result-label')).toHaveText('FAIL');
    await expect(page.getByTestId('damp-heat-report-result')).toContainText('12.00 %');
  });

  test('surfaces a backend error message inline', async ({ page }) => {
    await page.route('**/api/tests/damp-heat/run', route =>
      route.fulfill({ status: 500, body: 'boom' }),
    );
    await page.goto('/tests/damp-heat');
    await page.waitForURL(/[?&]tab=dh\b/);
    await page.getByTestId('damp-heat-generate-report').click();
    await expect(page.getByTestId('damp-heat-report-error')).toContainText('HTTP 500');
  });
});
