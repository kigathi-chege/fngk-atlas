import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The fixture server serves this folder as the local context's root.
const browserRoot = process.env.ATLAS_E2E_ROOT ?? '/tmp/fngk-atlas-browser-root';
const repo = path.join(browserRoot, 'gitrepo');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

test.setTimeout(45_000);
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Atlas E2E');
  git('config', 'user.email', 'e2e@example.test');
  writeFileSync(path.join(repo, 'notes.txt'), 'alpha\nbeta\ngamma\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial notes');
});
// Other specs list the fixture root; leave it as they expect.
test.afterAll(() => rmSync(repo, { recursive: true, force: true }));

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.root-dock')).toHaveAttribute('data-layout-ready', 'true');
  // The fixture also offers a Device; work in the local context that holds the repository.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('atlas:open-root', { detail: { contextId: 'local', path: '/' } })));
  await expect(page.locator('.tree-explorer .tree-row', { hasText: 'gitrepo' })).toBeVisible();
}
async function openSourceControl(page: Page) {
  await page.getByRole('navigation', { name: 'Atlas activity' }).getByRole('button', { name: 'Open Source Control' }).click();
  const panel = page.locator('section.scm-panel');
  await expect(panel).toBeVisible();
  if (await panel.getByRole('textbox', { name: 'Repository folder' }).isVisible()) {
    await panel.getByRole('textbox', { name: 'Repository folder' }).fill('/gitrepo');
    await panel.getByRole('button', { name: 'Open', exact: true }).click();
  }
  await expect(panel.getByRole('combobox', { name: 'Branch' })).toHaveValue('main');
  return panel;
}

test('edits, shows gutter markers and tree status, stages, commits and lists the commit', async ({ page }) => {
  await ready(page);
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('atlas:open-file', { detail })), { contextId: 'local', path: '/gitrepo/notes.txt', pinned: true });
  const editor = page.locator('.file-panel:visible .cm-content');
  await expect(editor).toContainText('alpha');
  // Change the first line and append one; the gutter compares against HEAD client-side.
  await page.locator('.file-panel:visible .cm-line').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('delta');
  await page.keyboard.press('Enter');
  await expect(page.locator('.file-panel:visible .cm-git-marker.modified')).toHaveCount(1);
  await expect(page.locator('.file-panel:visible .cm-git-marker.added')).toHaveCount(1);
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFileSync(path.join(repo, 'notes.txt'), 'utf8')).toBe('alpha edited\nbeta\ngamma\ndelta\n');

  // The tree marks the repository folder, then the file once it is visible.
  const tree = page.locator('.tree-explorer');
  // Saving reveals the file's folder; expand it only if it is still closed.
  if (!(await tree.locator('.tree-row', { hasText: 'notes.txt' }).isVisible())) await tree.locator('.tree-row', { hasText: 'gitrepo' }).click();
  await expect(tree.locator('.tree-row', { hasText: 'notes.txt' })).toBeVisible();
  await expect(tree.locator('.tree-row', { hasText: 'notes.txt' }).locator('.git-tree-letter')).toHaveText('M');
  await expect(tree.locator('.tree-row', { hasText: 'notes.txt' })).toHaveAttribute('data-git', 'modified');

  const panel = await openSourceControl(page);
  const changes = panel.getByRole('region', { name: 'Changes' });
  await expect(changes.getByText('notes.txt')).toBeVisible();

  // The diff opens side by side and toggles to inline.
  await changes.getByRole('button', { name: /notes\.txt/ }).first().click();
  const diff = page.getByRole('region', { name: 'Diff of notes.txt' });
  await expect(diff.locator('.cm-mergeView')).toBeVisible();
  await expect(diff.locator('.cm-mergeView .cm-changedLine').first()).toBeVisible();
  await diff.getByRole('button', { name: 'Show inline' }).click();
  await expect(diff.locator('.cm-mergeView')).toHaveCount(0);
  await expect(diff.locator('.cm-deletedChunk').first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Atlas activity' }).getByRole('button', { name: 'Open Source Control' }).click();
  await panel.getByRole('button', { name: 'Stage notes.txt' }).click();
  await expect(panel.getByRole('region', { name: 'Staged' }).getByText('notes.txt')).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Changes' })).toHaveCount(0);
  await expect(panel.getByText('Atlas E2E <e2e@example.test>')).toBeVisible();

  await panel.getByRole('textbox', { name: 'Commit message' }).fill('Edit notes from Atlas');
  await panel.getByRole('textbox', { name: 'Commit message' }).press('Control+Enter');
  await expect(panel.getByRole('region', { name: 'History' }).getByText('Edit notes from Atlas')).toBeVisible();
  await expect(panel.getByText('No changes.')).toBeVisible();
  expect(git('log', '-1', '--format=%s').trim()).toBe('Edit notes from Atlas');
  await expect(tree.locator('.tree-row', { hasText: 'notes.txt' }).locator('.git-tree-letter')).toHaveCount(0);
  // HEAD moved, so the editor gutter clears.
  await page.locator('.atlas-tab', { hasText: 'notes.txt' }).first().click();
  await expect(page.locator('.file-panel:visible .cm-git-marker')).toHaveCount(0);
});

test('discards a change only after confirmation and keeps a backup', async ({ page }) => {
  writeFileSync(path.join(repo, 'notes.txt'), 'scribbled over\n');
  writeFileSync(path.join(repo, 'scratch.tmp'), 'temporary\n');
  await ready(page);
  const panel = await openSourceControl(page);
  await panel.getByRole('button', { name: 'Refresh source control' }).click();
  await expect(panel.getByRole('region', { name: 'Untracked' }).getByText('scratch.tmp')).toBeVisible();

  await panel.getByRole('button', { name: 'Discard notes.txt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard changes to notes.txt?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(readFileSync(path.join(repo, 'notes.txt'), 'utf8')).toBe('scribbled over\n');

  await panel.getByRole('button', { name: 'Discard notes.txt' }).click();
  await page.getByRole('dialog', { name: 'Discard changes to notes.txt?' }).getByRole('button', { name: 'Discard' }).click();
  await expect(panel.getByRole('region', { name: 'Changes' })).toHaveCount(0);
  expect(readFileSync(path.join(repo, 'notes.txt'), 'utf8')).toBe('alpha edited\nbeta\ngamma\ndelta\n');
  await expect(page.getByText(/Discarded\. Backup: .*git-backups/).first()).toBeVisible();

  await panel.getByRole('button', { name: 'Discard scratch.tmp' }).click();
  await page.getByRole('dialog', { name: 'Discard changes to scratch.tmp?' }).getByRole('button', { name: 'Discard' }).click();
  await expect(panel.getByText('No changes.')).toBeVisible();
});
