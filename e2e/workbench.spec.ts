import {expect,test} from '@playwright/test';

test('renders a resizable FNGK Atlas workbench with files, editor, evidence, and terminal',async({page})=>{
  const errors:string[]=[];page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.getByText('FNGK Atlas',{exact:true}).first()).toBeVisible();await expect(page.locator('.dv-dockview')).toHaveCount(1);
  await expect(page.getByText('Architecture',{exact:true}).first()).toBeVisible();await expect(page.getByText('Functions & coverage',{exact:true}).first()).toBeVisible();await expect(page.getByText('Filesystem',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:/Atlas process host/}).click();await expect(page.getByRole('button',{name:/package\.json/})).toBeVisible();await page.getByRole('button',{name:/package\.json/}).click();
  await expect(page.locator('.cm-editor')).toBeVisible();await expect(page.locator('.cm-content')).toContainText('fngk-atlas');await expect(page.locator('.cm-gutters')).toBeVisible();
  await page.locator('.cm-content').click();await expect(page.locator('.cm-cursor')).toBeVisible();
  await page.locator('.context-row').filter({hasText:'fngk-device · reachable'}).getByRole('button',{name:/kigathi/}).click();await page.getByRole('button',{name:'Open terminal'}).click();await expect(page.getByText('Terminal',{exact:true}).first()).toBeVisible();await expect(page.locator('.terminal-panel header')).toContainText('Live · session-1');
  const separators=page.locator('.dv-sash');expect(await separators.count()).toBeGreaterThan(1);
  await page.reload();await expect(page.locator('.dv-dockview')).toHaveCount(1);await expect(page.getByText('Filesystem',{exact:true}).first()).toBeVisible();
  expect(errors).toEqual([]);
});
