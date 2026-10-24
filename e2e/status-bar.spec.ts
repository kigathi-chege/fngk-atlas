import { expect, test } from "@playwright/test";

test('shows a failed open in the status bar and explains it in the events drawer', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.root-dock')).toHaveAttribute('data-layout-ready', 'true');
  const bar = page.getByRole('contentinfo', { name: 'Status' });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('atlas:open-file', { detail: { contextId: 'local', path: '/definitely-not-an-atlas-file' } })));

  // The failure stays in the bar, with a count on the events button, until the drawer is opened.
  await expect(bar.locator('.status-activity.failed')).toContainText('Opening /definitely-not-an-atlas-file');
  const events = bar.getByRole('button', { name: 'Recent events, 1 new errors' });
  await expect(events).toBeVisible();
  await events.click();

  const drawer = page.getByRole('region', { name: 'Recent events' });
  await expect(drawer.getByRole('tab', { name: 'Problems' })).toHaveAttribute('aria-selected', 'true');
  const row = drawer.locator('li.error', { hasText: 'Opening /definitely-not-an-atlas-file' });
  await expect(row).toBeVisible();
  await row.locator('.status-event').click();
  await expect(row.getByText('file.open')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Copy details' })).toBeVisible();

  // Opening the drawer marks the error as seen; Escape closes it.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(bar.getByRole('button', { name: 'Recent events', exact: true })).toBeVisible();
});
