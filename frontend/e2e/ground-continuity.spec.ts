import { test, expect, Route } from '@playwright/test';

/**
 * Playwright e2e for the Ground Continuity test page (IEC 61730-2 MST 13).
 *
 * Both backend endpoints are mocked at the network layer so the spec can
 * run without a live FastAPI process. The mocked /run response mirrors
 * the real backend response shape (see backend/main.py).
 */

const PROBE_MAP_URL = '**/api/tests/ground-continuity/probe-map';
const RUN_URL = '**/api/tests/ground-continuity/run';

const MOCK_PROBE_MAP = {
  standard: 'IEC 61730-2 MST 13',
  min_test_current_a: 25.0,
  max_resistance_ohm: 0.1,
  duration_per_point_s: 120.0,
  probes: [
    { id: 'p1', label: 'Frame TL', x: 0.05, y: 0.05 },
    { id: 'p2', label: 'Frame TR', x: 0.95, y: 0.05 },
    { id: 'p3', label: 'Frame BL', x: 0.05, y: 0.95 },
    { id: 'p4', label: 'Frame BR', x: 0.95, y: 0.95 },
    { id: 'p5', label: 'J-Box GND', x: 0.5, y: 0.55 },
  ],
};

function makeRunResponse(opts: { failProbeId?: string } = {}) {
  return {
    session_id: 'test-session-001',
    module_id: 'MOD-DEFAULT',
    standard: 'IEC 61730-2 MST 13 (Continuity of equipotential bonding)',
    started_ts: 1_700_000_000,
    ended_ts: 1_700_000_010,
    test_current_a: 25.0,
    pass_resistance_ohm: 0.1,
    overall_pass: opts.failProbeId === undefined,
    result: opts.failProbeId === undefined ? 'PASS' : 'FAIL',
    artifact_dir: '/tmp/artifacts/test-session-001',
    report_path: '/tmp/artifacts/test-session-001/report.pdf',
    probes: MOCK_PROBE_MAP.probes.map(p => {
      const failing = p.id === opts.failProbeId;
      return {
        probe_id: p.id,
        label: p.label,
        test_current_a: 25.0,
        duration_s: 9.6,
        n_samples: 50,
        mean_voltage_v: failing ? 5.0 : 1.25,
        mean_current_a: 25.0,
        resistance_ohm: failing ? 0.2 : 0.05,
        resistance_min_ohm: failing ? 0.19 : 0.045,
        resistance_max_ohm: failing ? 0.21 : 0.055,
        contact_stability_pct: 99.1,
        pass_resistance_ohm: 0.1,
        passed: !failing,
        csv_path: `/tmp/artifacts/test-session-001/${p.id}.csv`,
      };
    }),
  };
}

test.describe('Ground Continuity (IEC 61730-2 MST 13)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(PROBE_MAP_URL, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PROBE_MAP),
      });
    });
  });

  test('renders setup, probe map, IEC reference', async ({ page }) => {
    await page.goto('/tests/ground-continuity');

    await expect(page.getByTestId('gc-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Ground Continuity/i })).toBeVisible();

    // The five default probes are rendered on the placeholder map.
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      await expect(page.getByTestId(`gc-probe-${id}`)).toBeVisible();
    }

    // IEC reference visible in footer.
    await expect(page.getByText(/IEC 61730-2 MST 13/i).first()).toBeVisible();
  });

  test('computes test current from rated current', async ({ page }) => {
    await page.goto('/tests/ground-continuity');
    // Default rated I = 9.5 A -> max(2.5*9.5, 25) = 25 A.
    await expect(page.getByTestId('gc-test-current')).toContainText('25.00 A');

    // Bump rated I to 12 A -> 30 A.
    const ratedInput = page.getByTestId('gc-input-rated-module-current-a-');
    await ratedInput.fill('12');
    await expect(page.getByTestId('gc-test-current')).toContainText('30.00 A');
  });

  test('runs sweep and renders pass verdict + per-probe table', async ({ page }) => {
    await page.route(RUN_URL, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeRunResponse()),
      });
    });

    await page.goto('/tests/ground-continuity');
    await page.getByTestId('gc-run').click();

    await expect(page.getByTestId('gc-results')).toBeVisible();
    await expect(page.getByTestId('gc-verdict')).toHaveText(/Overall: PASS/);
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      const row = page.getByTestId(`gc-row-${id}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText('PASS');
      await expect(row).toContainText('0.050000');
    }
    await expect(page.getByTestId('gc-artifact-dir')).toContainText(
      '/tmp/artifacts/test-session-001',
    );
    await expect(page.getByTestId('gc-report-path')).toContainText('report.pdf');
  });

  test('flags failing probe and overall fail', async ({ page }) => {
    await page.route(RUN_URL, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeRunResponse({ failProbeId: 'p4' })),
      });
    });

    await page.goto('/tests/ground-continuity');
    await page.getByTestId('gc-run').click();

    await expect(page.getByTestId('gc-verdict')).toHaveText(/Overall: FAIL/);
    await expect(page.getByTestId('gc-row-p4')).toContainText('FAIL');
    await expect(page.getByTestId('gc-row-p1')).toContainText('PASS');
  });
});
