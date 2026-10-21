import { expect, test, type Page } from '@playwright/test';

test.setTimeout(45_000);
const b64 = (value: string) => Buffer.from(value).toString('base64');
async function create(page: Page, path: string, type: 'file' | 'directory', content = '') {
  const response = await page.request.post('/api/files', { data: { contextId: 'local', path, type, ...(type === 'file' ? { contentBase64: b64(content) } : {}) } });
  expect(response.status(), await response.text()).toBe(201);
}
async function fixture(page: Page) {
  const stamp = Date.now().toString(36), root = `/e2e-sfx-${stamp}`, name = `quickopen${stamp}`;
  for (const dir of [root, `${root}/deep`, `${root}/deep/nested`, `${root}/node_modules`]) await create(page, dir, 'directory');
  await create(page, `${root}/deep/nested/${name}.txt`, 'file', `the ${name} marker lives here\n`);
  await create(page, `${root}/node_modules/${name}-dep.js`, 'file', `${name}\n`);
  return { root, name };
}
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.root-dock')).toHaveAttribute('data-layout-ready', 'true');
  await page.locator('.devices-panel').getByRole('button', { name: /Atlas process host/ }).click();
  await expect(page.getByRole('button', { name: /package\.json/ })).toBeVisible();
}
const searchEvents = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('atlas.events.v1') ?? '[]') as Array<{ type: string; state: string; message?: string }>).filter(event => event.type === 'filesystem.search'));

test('tree filter finds names deep below the root and hands contents to the Search panel', async ({ page }) => {
  const { root, name } = await fixture(page);
  await ready(page);
  const field = page.getByLabel('Search filesystem');
  await field.fill(name);
  const tree = page.locator('.tree-explorer');
  await expect(tree.getByText(`${root}/deep/nested/${name}.txt`, { exact: true })).toBeVisible();
  // node_modules is pruned.
  await expect(tree.getByText(`${root}/node_modules/${name}-dep.js`, { exact: true })).toHaveCount(0);
  await tree.getByRole('button', { name: `Search contents for “${name}” in this folder` }).click();
  const panel = page.locator('section.search-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Search query' })).toHaveValue(name);
  await expect(panel.getByRole('textbox', { name: 'Search root' })).toHaveValue('/');
  await expect(panel.getByText(`${name}.txt`).first()).toBeVisible();
  await field.fill(`${name}-nothing`);
  await expect(tree.getByText('No matches in /', { exact: true })).toBeVisible();
});

test('typing quickly shows only the final query and records no superseded searches', async ({ page }) => {
  const { root, name } = await fixture(page);
  await ready(page);
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/files/search')) requests.push(new URL(request.url()).searchParams.get('query') ?? ''); });
  const field = page.getByLabel('Search filesystem');
  await field.click();
  await field.pressSequentially(name, { delay: 15 });
  const tree = page.locator('.tree-explorer');
  await expect(tree.getByText(`${root}/deep/nested/${name}.txt`, { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  expect(requests.at(-1)).toBe(name);
  expect(requests.length).toBeLessThan(name.length);
  expect(await searchEvents(page)).toEqual([]);
  await expect(page.locator('.tree-explorer .search-file-row')).toHaveCount(1);
});

test('global search bar finds a file by name and opens it', async ({ page }) => {
  const { root, name } = await fixture(page);
  await ready(page);
  const bar = page.getByLabel('Search Atlas');
  await bar.fill(name);
  const results = page.getByRole('listbox', { name: 'Unified search results' });
  const option = results.getByRole('option', { name: new RegExp(`^file ${name}\\.txt`) });
  await expect(option).toBeVisible();
  await expect(option).toContainText(`${root}/deep/nested/${name}.txt`);
  await expect(results.getByRole('option', { name: /Search file contents for/ })).toBeVisible();
  await option.click();
  await expect(page.locator('.file-panel:visible .cm-content')).toContainText(`the ${name} marker lives here`);
});
