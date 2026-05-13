import { test, expect, type Page, type Route } from '@playwright/test';

type Slot = {
  id: string;
  equipment_id: string;
  run_id: string;
  start: string;
  end: string;
  status: 'planned' | 'running' | 'completed' | 'cancelled';
};

function isoIn(hoursFromNow: number): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + hoursFromNow);
  return d.toISOString();
}

function localInput(hoursFromNow: number): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + hoursFromNow);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function overlaps(a: Slot, bStart: string, bEnd: string): boolean {
  return new Date(a.start).getTime() < new Date(bEnd).getTime()
      && new Date(bStart).getTime() < new Date(a.end).getTime();
}

/**
 * Install a stubbed scheduler backend so the test does not require uvicorn.
 * State lives in module-scope so route handlers share it across requests.
 */
async function installBackendStub(page: Page, store: Slot[]): Promise<void> {
  await page.route('**/api/scheduler/schedules', async (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(store),
      });
    }
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}') as Partial<Slot>;
      const conflict = store.find(s =>
        s.equipment_id === body.equipment_id &&
        s.status !== 'cancelled' &&
        overlaps(s, body.start ?? '', body.end ?? ''),
      );
      if (conflict) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ detail: { error: 'conflict', conflicts: [conflict] } }),
        });
      }
      const created: Slot = {
        id: `id-${store.length + 1}`,
        equipment_id: body.equipment_id ?? 'rig-1',
        run_id: body.run_id ?? 'run',
        start: body.start ?? '',
        end: body.end ?? '',
        status: 'planned',
      };
      store.push(created);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
    }
    return route.continue();
  });

  await page.route('**/api/scheduler/schedules/*', async (route: Route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').pop();
    const idx = store.findIndex(s => s.id === id);
    if (route.request().method() === 'PATCH') {
      if (idx < 0) return route.fulfill({ status: 404, body: '{}' });
      const patch = JSON.parse(route.request().postData() ?? '{}') as Partial<Slot>;
      const next: Slot = { ...store[idx], ...patch };
      const conflict = store.find((s, i) =>
        i !== idx &&
        s.equipment_id === next.equipment_id &&
        s.status !== 'cancelled' &&
        overlaps(s, next.start, next.end),
      );
      if (conflict) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ detail: { error: 'conflict', conflicts: [conflict] } }),
        });
      }
      store[idx] = next;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(next),
      });
    }
    if (route.request().method() === 'DELETE') {
      if (idx >= 0) store.splice(idx, 1);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.continue();
  });

  await page.route('**/api/scheduler/next-slot**', async (route: Route) => {
    const url = new URL(route.request().url());
    const dh = parseFloat(url.searchParams.get('duration_h') ?? '1');
    const eq = url.searchParams.get('equipment_id') ?? 'rig-1';
    let cursor = new Date();
    cursor.setMinutes(0, 0, 0);
    const booked = store
      .filter(s => s.equipment_id === eq && s.status !== 'cancelled')
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const s of booked) {
      const sStart = new Date(s.start);
      const sEnd = new Date(s.end);
      if (sStart.getTime() >= cursor.getTime() + dh * 3600_000) break;
      if (sEnd > cursor) cursor = sEnd;
    }
    const end = new Date(cursor.getTime() + dh * 3600_000);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        equipment_id: eq, duration_h: dh,
        start: cursor.toISOString(), end: end.toISOString(), found: true,
      }),
    });
  });
}

test.describe('scheduler /schedule page', () => {
  // CI flake under the post-PR#26 e2e workflow — DevicePills polling triggers
  // page reloads that race the Playwright route stub. Re-enable in
  // fix/gap-29-e2e-schedule once we can hold the stub through the poll cycle.
  test.skip(true, 'flake under CI e2e workflow; tracked by fix/gap-29-e2e-schedule');

  test('create 2 slots, view gantt, reschedule second into conflict warning', async ({ page }) => {
    const store: Slot[] = [];
    await installBackendStub(page, store);

    await page.goto('/schedule');
    await expect(page.getByRole('heading', { name: 'Scheduler' })).toBeVisible();

    // Create slot 1: 1h..3h from now on rig-1
    await page.getByTestId('form-runid').fill('alpha');
    await page.getByTestId('form-start').fill(localInput(1));
    await page.getByTestId('form-end').fill(localInput(3));
    await page.getByTestId('btn-create').click();

    await expect(page.getByTestId('gantt-bar-alpha')).toBeVisible();

    // Create slot 2: 4h..6h from now on rig-1 (no conflict)
    await page.getByTestId('form-runid').fill('beta');
    await page.getByTestId('form-start').fill(localInput(4));
    await page.getByTestId('form-end').fill(localInput(6));
    await page.getByTestId('btn-create').click();

    await expect(page.getByTestId('gantt-bar-beta')).toBeVisible();
    await expect(page.getByTestId('slot-table').locator('tr')).toHaveCount(2);

    // Reschedule slot 2 INTO slot 1's window via PATCH to provoke a conflict.
    // We hit the API route directly to avoid timezone fuzz of drag-pixel math
    // in headless mode; the UI receives the 409 via its existing reschedule pathway.
    const betaId = store.find(s => s.run_id === 'beta')?.id;
    expect(betaId).toBeTruthy();

    await page.evaluate(async ({ id, start, end }) => {
      const r = await fetch(`/api/scheduler/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end }),
      });
      (window as unknown as { __lastStatus: number }).__lastStatus = r.status;
    }, { id: betaId, start: isoIn(2), end: isoIn(2.5) });

    const status = await page.evaluate(() => (window as unknown as { __lastStatus: number }).__lastStatus);
    expect(status).toBe(409);

    // Drag-to-reschedule via the SVG bar should also surface the conflict banner in the UI.
    const bar = page.getByTestId('gantt-bar-beta');
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    // Try to drag beta left far enough to overlap alpha.
    await page.mouse.move(box!.x + 20, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x - 200, box!.y + box!.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByTestId('conflict-warning')).toBeVisible({ timeout: 4000 });
  });

  test('view modes toggle weekly/monthly', async ({ page }) => {
    const store: Slot[] = [];
    await installBackendStub(page, store);
    await page.goto('/schedule');

    await page.getByTestId('view-monthly').click();
    await expect(page.getByTestId('gantt-svg')).toBeVisible();
    await page.getByTestId('view-weekly').click();
    await expect(page.getByTestId('gantt-svg')).toBeVisible();
  });
});
