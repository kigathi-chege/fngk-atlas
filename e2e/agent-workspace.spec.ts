import { expect, test } from '@playwright/test';

test('Agent Chat opens from the activity rail and survives minimization without replacing a live terminal', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.root-dock')).toHaveAttribute('data-layout-ready', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('atlas:open-terminal')));
  await expect(page.locator('.terminal-panel')).toContainText('Live');
  await page.getByRole('button', { name: 'Open Agent Chat' }).click();
  await expect(page.getByRole('region', { name: 'Atlas Agent Chat' })).toBeVisible();
  await page.getByRole('button', { name: 'Minimize Agent Chat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Atlas Agent Chat' })).toBeHidden();
  await page.getByRole('button', { name: 'Restore Agent Chat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Atlas Agent Chat' })).toBeVisible();
  await expect(page.locator('.terminal-panel')).toContainText('Live');
});
