import { expect, test } from '@playwright/test';

test('agent workspace recovery keeps Atlas usable when Calculator is unavailable', async ({ page }) => {
  await page.route('**/api/agent-chat/conversations', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'calculator_unavailable', message: 'Calculator provider is not configured.' }) }));
  await page.goto('/');
  await expect(page.locator('.root-dock')).toHaveAttribute('data-layout-ready', 'true');
  await page.getByRole('button', { name: 'Open Agent Chat' }).click();
  await page.getByRole('textbox', { name: 'Message Atlas Agent' }).fill('inspect this device');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Calculator provider is not configured.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Atlas activity' }).getByRole('button', { name: 'Open terminal' }).click();
  await expect(page.locator('.terminal-panel')).toContainText('Live');
});
