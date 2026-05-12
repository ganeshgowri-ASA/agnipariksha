import { test, expect } from '@playwright/test';

test('raise a ticket from a forced error toast and see it on /tickets', async ({ page }) => {
  await page.goto('/');

  // Force an error toast and open the notifications drawer.
  await page.getByTestId('force-error-btn').click();
  await page.getByRole('button', { name: /notifications/i }).click();

  // The error row exposes a "Raise ticket" button.
  const errorRow = page.getByTestId('notif-error').first();
  await expect(errorRow).toBeVisible();
  await errorRow.getByTestId('raise-ticket-from-toast').click();

  // Fill the dialog with a recognisable title and submit.
  const stamp = `E2E ${Date.now()}`;
  await page.getByTestId('ticket-title').fill(stamp);
  await page.getByTestId('ticket-priority').selectOption('high');
  await page.getByTestId('ticket-submit').click();

  // Dialog closes on success.
  await expect(page.getByTestId('raise-ticket-dialog')).toHaveCount(0);

  // The new card shows up in the kanban Open column.
  await page.goto('/tickets');
  const openCol = page.getByTestId('kanban-col-open');
  await expect(openCol).toBeVisible();
  await expect(openCol.getByText(stamp)).toBeVisible({ timeout: 10_000 });
});

test('raise a maintenance ticket from the tickets page button', async ({ page }) => {
  await page.goto('/tickets');
  await page.getByTestId('raise-ticket-btn').click();

  const stamp = `Maint ${Date.now()}`;
  await page.getByTestId('ticket-type-maintenance').click();
  await page.getByTestId('ticket-title').fill(stamp);
  await page.getByTestId('ticket-submit').click();

  await expect(page.getByTestId('raise-ticket-dialog')).toHaveCount(0);
  const openCol = page.getByTestId('kanban-col-open');
  await expect(openCol.getByText(stamp)).toBeVisible({ timeout: 10_000 });
});
