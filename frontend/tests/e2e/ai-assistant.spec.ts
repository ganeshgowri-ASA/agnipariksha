/**
 * E2E flow for the AI assistant:
 *   1. Create a PV module via the header selector.
 *   2. Run a quick demo on the bypass-diode tab so a backend TestRun
 *      gets opened (and telemetry flushed into it).
 *   3. Open the AI panel, ask the Tj question, assert the answer
 *      references Tj, the -2 mV/°C coefficient and the diode part.
 *
 * The test runs against the no-LLM-key fallback path so it is
 * hermetic in CI — the assistant still demonstrates tool grounding
 * via recompute_analysis + suggest_pass_fail and the IEC clause
 * citation for MQT 18.
 */
import { expect, test } from '@playwright/test';

const MOD_MANUFACTURER = `Acme-${Date.now()}`;
const MOD_MODEL = 'ACME-460M';
const DIODE_PART = 'PV-30SHK4';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('threaded AI assistant grounds Tj answer in module + run', async ({ page }) => {
  // 1. Open module selector and create a new module.
  await page.getByTestId('module-selector').click();
  await page.getByTestId('module-new').click();
  const modal = page.getByTestId('module-modal');
  await modal.waitFor({ state: 'visible' });

  await modal.getByLabel('Manufacturer *').fill(MOD_MANUFACTURER);
  await modal.getByLabel('Model *').fill(MOD_MODEL);
  await modal.getByLabel('Pmax @ STC (W)').fill('460');
  await modal.getByLabel('Voc (V)').fill('49.5');
  await modal.getByLabel('Isc (A)').fill('11.85');
  await modal.getByLabel('Vmpp (V)').fill('41.7');
  await modal.getByLabel('Impp (A)').fill('11.03');
  await modal.getByLabel('Bypass diode part').fill(DIODE_PART);
  await page.getByTestId('module-save').click();
  await modal.waitFor({ state: 'hidden' });

  // The header chip should now show the new module.
  await expect(page.getByTestId('module-selector')).toContainText(MOD_MODEL);

  // 2. Switch to the bypass-diode tab and start a demo run.
  await page.getByRole('tab', { name: /Bypass Diode|BDT/ }).click();
  await page.getByRole('button', { name: /^Start$/ }).click();

  // Let demo telemetry tick a few times so the backend run picks up samples.
  await page.waitForTimeout(2500);

  // 3. Open the AI panel (it should already be visible — the side panel
  //    defaults to open) and pose the Tj question.
  const aiPanel = page.getByTestId('ai-panel');
  await expect(aiPanel).toBeVisible();

  const input = page.getByTestId('ai-input');
  await input.fill('What is the calculated Tj for this run and is it within datasheet limits?');
  await page.getByTestId('ai-send').click();

  // The assistant should stream a response. Wait until the messages
  // container has rendered an assistant bubble (Markdown component).
  const messages = page.getByTestId('ai-messages');
  await expect(messages).toContainText(/Tj/i, { timeout: 20_000 });
  await expect(messages).toContainText(/mV\s*\/\s*°?C/i);
  await expect(messages).toContainText(DIODE_PART);

  // Citation pill for MQT 18 (or its textual reference) is shown.
  await expect(messages).toContainText(/MQT\s*18/);
});
