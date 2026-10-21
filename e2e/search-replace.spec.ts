import { expect, test, type Page } from '@playwright/test';

test.setTimeout(45_000);
const b64 = (value: string) => Buffer.from(value).toString('base64');
async function create(page: Page, path: string, content: string) {
  const response = await page.request.post('/api/files', { data: { contextId: 'local', path, type: 'file', contentBase64: b64(content) } });
  expect(response.status(), await response.text()).toBe(201);
}
async function disk(page: Page, path: string) { return (await (await page.request.get(`/api/files/content?contextId=local&path=${encodeURIComponent(path)}`)).json()).text as string; }
async function ready(page: Page) { await page.goto('/'); await expect(page.locator('.root-dock')).toHaveAttribute('data-layout-ready', 'true'); }
const openFile = (page: Page, path: string) => page.evaluate(detail => window.dispatchEvent(new CustomEvent('atlas:open-file', { detail })), { contextId: 'local', path });
const editor = (page: Page) => page.locator('.file-panel:visible .cm-content');

test('Ctrl-F and Ctrl-H open the editor search and replace all, then save', async ({ page }) => {
  const path = `/e2e-find-${Date.now()}.txt`;
  await create(page, path, 'alpha one\nbeta\nalpha two\n');
  await ready(page);
  await openFile(page, path);
  await expect(editor(page)).toContainText('alpha two');
  await editor(page).click();
  await page.keyboard.press('Control+f');
  const panel = page.locator('.file-panel:visible .cm-search');
  await expect(panel).toBeVisible();
  await expect(panel.locator('input[name=search]')).toBeFocused();
  await page.keyboard.type('alpha');
  await page.keyboard.press('Control+h');
  await expect(panel.locator('input[name=replace]')).toBeFocused();
  await page.keyboard.type('omega');
  await panel.locator('button[name=replaceAll]').click();
  await expect(editor(page)).toContainText('omega one');
  await expect(editor(page)).toContainText('omega two');
  await editor(page).click();
  await page.keyboard.press('Control+s');
  await expect.poll(() => disk(page, path)).toBe('omega one\nbeta\nomega two\n');
  // The search panel closes with Escape and does not leave the editor stuck.
  await panel.locator('input[name=search]').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('replaces across files from the Search panel: preview, deselect a hunk, apply, undo', async ({ page }) => {
  const root = `/e2e-replace-${Date.now()}`;
  expect((await page.request.post('/api/files', { data: { contextId: 'local', path: root, type: 'directory' } })).status()).toBe(201);
  await create(page, `${root}/a.ts`, 'const foo = 1;\nfoo();\n');
  await create(page, `${root}/b.ts`, 'foo\n');
  await create(page, `${root}/c.md`, 'foo in docs\n');
  await create(page, `${root}/d.ts`, 'export {};\n');
  await ready(page);
  // An open editor with unsaved edits is replaced in its buffer, not on disk.
  await openFile(page, `${root}/d.ts`);
  await expect(editor(page)).toContainText('export');
  await editor(page).fill('let foo = 2;\n');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+Shift+H');
  const search = page.getByRole('region', { name: 'Search in files' }).or(page.locator('section.search-panel'));
  await expect(search).toBeVisible();
  // The panel searches the workbench's selected context; these files are local.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('atlas:search-request', { detail: { contextId: 'local', replace: true } })));
  await search.getByRole('textbox', { name: 'Search query' }).fill('foo');
  await search.getByRole('textbox', { name: 'Replacement' }).fill('bar');
  await search.getByRole('button', { name: 'Match whole word' }).click();
  await search.getByRole('textbox', { name: 'Search root' }).fill(root);
  await search.getByRole('button', { name: 'Filters' }).click();
  await search.getByRole('textbox', { name: 'Files to include' }).fill('*.ts');
  await search.getByRole('button', { name: 'Preview replace' }).click();
  await expect(search.getByRole('status')).toContainText('4 replacements in 3 files');
  await expect(search.locator(`.sp-result-file[data-path="${root}/d.ts"] .sp-badge`)).toHaveText('unsaved editor');
  await expect(search.locator(`.sp-result-file[data-path="${root}/c.md"]`)).toHaveCount(0);
  await search.getByRole('checkbox', { name: "Replace at line 2 column 1 in a.ts" }).uncheck();
  await search.getByRole('button', { name: 'Apply replace' }).click();
  await expect(search.getByRole('status')).toContainText('Replaced in 3 files');
  expect(await disk(page, `${root}/a.ts`)).toBe('const bar = 1;\nfoo();\n');
  expect(await disk(page, `${root}/b.ts`)).toBe('bar\n');
  expect(await disk(page, `${root}/c.md`)).toBe('foo in docs\n');
  expect(await disk(page, `${root}/d.ts`)).toBe('export {};\n');
  await openFile(page, `${root}/d.ts`);
  await expect(editor(page)).toContainText('let bar = 2;');
  // Versions were kept for the files written on disk.
  const versions = await (await page.request.get(`/api/files/versions?contextId=local&path=${encodeURIComponent(`${root}/a.ts`)}`)).json();
  expect(versions.versions).toHaveLength(1);
  await search.getByRole('button', { name: 'Undo replace' }).click();
  await expect(search.getByRole('status')).toContainText('Undid the replace in 3 files');
  expect(await disk(page, `${root}/a.ts`)).toBe('const foo = 1;\nfoo();\n');
  expect(await disk(page, `${root}/b.ts`)).toBe('foo\n');
  await expect(editor(page)).toContainText('let foo = 2;');
  // Results open the file at the match.
  await search.getByRole('button', { name: 'Show replace' }).or(search.getByRole('button', { name: 'Hide replace' })).click();
  await search.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(search.getByRole('status')).toContainText('in 2 files');
  await search.locator(`.sp-result-file[data-path="${root}/a.ts"] .sp-match`).nth(1).click();
  await expect(page.locator('.file-panel:visible header strong')).toContainText(`${root}/a.ts`);
  await expect(page.locator('.file-panel:visible .cm-activeLine')).toContainText('foo();');
});

test('restores a previous version from the editor with a diff preview', async ({ page }) => {
  const path = `/e2e-versions-${Date.now()}.txt`;
  await create(page, path, 'one\n');
  await ready(page);
  await openFile(page, path);
  await expect(editor(page)).toContainText('one');
  for (const next of ['two', 'three']) {
    await editor(page).fill(`${next}\n`);
    await page.keyboard.press('Control+s');
    await expect.poll(() => disk(page, path)).toBe(`${next}\n`);
  }
  await page.locator('.file-panel:visible').getByRole('button', { name: 'Restore previous version' }).click();
  const history = page.getByRole('region', { name: 'Previous versions' });
  await expect(history.getByText('Version 1')).toBeVisible();
  await expect(history.getByText('Version 2')).toBeVisible();
  await expect(history.locator('li')).toHaveCount(2);
  await history.getByRole('button', { name: 'Preview version 2' }).click();
  await expect(history.locator('.diff-remove')).toContainText('three');
  await expect(history.locator('.diff-add')).toContainText('one');
  await history.getByRole('button', { name: 'Restore version 2' }).click();
  await expect.poll(() => disk(page, path)).toBe('one\n');
  await expect(editor(page)).toHaveText('one');
  await expect(page.locator('.file-panel:visible header strong')).not.toContainText('●');
  // The restore was itself versioned: "three" is now the newest previous version.
  await expect(history.locator('li')).toHaveCount(3);
  const latest = await (await page.request.get(`/api/files/versions/content?contextId=local&path=${encodeURIComponent(path)}&slot=1`)).json();
  expect(latest.text).toBe('three\n');
});
