import { test, expect } from '@playwright/test';

const CARDS = [
  'overview-card-kpis',
  'overview-card-equipment',
  'overview-card-schedule',
  'overview-card-tickets',
  'overview-card-spares',
  'overview-card-ai',
];

test('/overview renders all 6 cards', async ({ page }) => {
  await page.goto('/overview');
  await expect(page.getByTestId('overview-root')).toBeVisible();

  for (const id of CARDS) {
    await expect(page.getByTestId(id), `card ${id}`).toBeVisible();
  }
});

test('/ redirects to /overview', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/overview$/);
});

test('/dashboard still renders the legacy tabbed dashboard', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('tab', { name: /Thermal Cycling|TC/ })).toBeVisible();
});
