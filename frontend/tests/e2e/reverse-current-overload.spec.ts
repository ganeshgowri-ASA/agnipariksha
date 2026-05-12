import { test, expect } from '@playwright/test';

const RCO_URL = '/tests/reverse-current-overload';

const MOCK_RESULT = {
  session_id: 'rco-test-session',
  started_at_ms: 0,
  ended_at_ms: 0,
  params: { isc_stc_a: 10, test_current_a: 13.5 },
  sample_count: 30,
  duration_s: 29,
  abort_reason: 'completed',
  passed: true,
  analysis: {
    standard: 'IEC 61730-2 MST 26',
    clauses: [
      'IEC 61730-2 §10.13 MST 26 — Reverse current overload',
      'IEC 61730-2 §10.1 MST 01 — Visual inspection (post-test)',
      'IEC 61730-2 §10.4 MST 15 — Wet leakage (post-test)',
    ],
    test_current_a: 13.5,
    duration_s: 29,
    duration_pct_of_target: 96.67,
    sample_count: 30,
    peak_current_a: 13.6,
    min_voltage_v: 1.0,
    peak_voltage_v: 30.0,
    peak_surface_temperature_c: 65.2,
    peak_jbox_temperature_c: 73.5,
    ambient_min_c: 28.9,
    ambient_max_c: 31.2,
    ambient_in_band: true,
    hotspot_event_count: 0,
    hotspot_events: [],
    time_temperature_profile: [],
    post_test_stubs: {
      MQT_01_visual_inspection: {
        status: 'deferred',
        description: 'Operator must perform IEC 61215-2 MQT 01 visual inspection',
      },
      MQT_15_wet_leakage: {
        status: 'deferred',
        description: 'Operator must perform IEC 61215-2 MQT 15 wet leakage at 500 V DC',
      },
    },
    failure_reasons: [],
    passed: true,
    verdict: 'PASS' as const,
  },
  csv_path: '/tmp/rco/raw_samples.csv',
  summary_path: '/tmp/rco/summary.json',
  hotspot_map_path: '/tmp/rco/hotspot_map.json',
};

test.describe('Reverse Current Overload — IEC 61730-2 MST 26', () => {
  test('renders setup panel with IEC clause reference', async ({ page }) => {
    await page.goto(RCO_URL);
    await expect(page.getByTestId('rco-page')).toBeVisible();
    await expect(page.getByTestId('rco-title')).toContainText('IEC 61730-2 MST 26');
    await expect(page.getByTestId('rco-setup')).toBeVisible();
    await expect(page.getByTestId('field-isc')).toHaveValue('10');
    await expect(page.getByTestId('field-duration')).toHaveValue('7200');
    await expect(page.getByTestId('field-amb-target')).toHaveValue('30');
    await expect(page.getByTestId('field-amb-tol')).toHaveValue('5');
    await expect(page.getByTestId('field-abort-temp')).toHaveValue('200');
  });

  test('computes 1.35 × Isc when operator edits Isc', async ({ page }) => {
    await page.goto(RCO_URL);
    const isc = page.getByTestId('field-isc');
    await isc.fill('12');
    await expect(page.getByTestId('test-current')).toContainText('16.2 A');
    await isc.fill('9.5');
    await expect(page.getByTestId('test-current')).toContainText('12.825 A');
  });

  test('runs demo and renders PASS verdict + IEC clauses + post-test stubs', async ({ page }) => {
    await page.route('**/api/tests/reverse-current/run', async route => {
      const req = route.request();
      const body = JSON.parse(req.postData() || '{}');
      expect(body.isc_stc_a).toBeGreaterThan(0);
      expect(body.duration_s).toBeGreaterThan(0);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_RESULT),
      });
    });

    await page.goto(RCO_URL);
    await page.getByTestId('run-button').click();

    await expect(page.getByTestId('rco-result')).toBeVisible();
    await expect(page.getByTestId('rco-verdict')).toHaveText('PASS');
    await expect(page.getByTestId('cell-std')).toContainText('IEC 61730-2 MST 26');
    await expect(page.getByTestId('cell-i-test')).toContainText('13.5');
    await expect(page.getByTestId('cell-peak-surface')).toContainText('65.2');
    await expect(page.getByTestId('cell-peak-jbox')).toContainText('73.5');
    await expect(page.getByTestId('cell-abort-reason')).toHaveText('completed');
    await expect(page.getByTestId('iec-clauses')).toContainText('MST 26');
    await expect(page.getByTestId('iec-clauses')).toContainText('MST 01');
    await expect(page.getByTestId('iec-clauses')).toContainText('MST 15');
    await expect(page.getByTestId('rco-artifacts')).toContainText('raw_samples.csv');
    await expect(page.getByTestId('stub-MQT_01_visual_inspection')).toContainText('deferred');
    await expect(page.getByTestId('stub-MQT_15_wet_leakage')).toContainText('deferred');
    await expect(page.getByTestId('hotspot-placeholder')).toBeVisible();
  });

  test('renders FAIL verdict + failure reasons when abort fires', async ({ page }) => {
    const fail = {
      ...MOCK_RESULT,
      passed: false,
      abort_reason: 'over_temperature',
      analysis: {
        ...MOCK_RESULT.analysis,
        passed: false,
        verdict: 'FAIL' as const,
        failure_reasons: ['aborted:over_temperature', 'hotspot_over_threshold'],
        hotspot_event_count: 3,
        peak_surface_temperature_c: 215.0,
      },
    };
    await page.route('**/api/tests/reverse-current/run', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fail),
      }),
    );

    await page.goto(RCO_URL);
    await page.getByTestId('hotspot-toggle').check();
    await page.getByTestId('run-button').click();

    await expect(page.getByTestId('rco-verdict')).toHaveText('FAIL');
    await expect(page.getByTestId('rco-failures')).toContainText('over_temperature');
    await expect(page.getByTestId('rco-failures')).toContainText('hotspot_over_threshold');
    await expect(page.getByTestId('cell-hotspot-count')).toContainText('3');
  });

  test('surfaces backend errors in the UI', async ({ page }) => {
    await page.route('**/api/tests/reverse-current/run', route =>
      route.fulfill({ status: 409, body: 'demo-only path' }),
    );

    await page.goto(RCO_URL);
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('rco-error')).toContainText('HTTP 409');
  });
});
