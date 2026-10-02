import { expect, test } from '@playwright/test';

test('Device Sessions opens from the activity rail and keeps its docked workspace panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.root-dock')).toHaveAttribute('data-layout-ready', 'true');
  await page.getByRole('button', { name: 'Open Device Sessions' }).click();
  await expect(page.locator('.device-sessions-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Minimize Device Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Device Sessions', exact: true }).click();
  await expect(page.locator('.device-sessions-panel')).toBeVisible();
});
