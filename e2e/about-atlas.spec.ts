import { expect, test } from "@playwright/test";

test('shows Atlas and FNGK versions in About Atlas from the command palette',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.root-dock')).toHaveAttribute('data-layout-ready','true');
  await page.getByRole('button',{name:'Command palette',exact:true}).click();
  await page.getByRole('textbox',{name:'Command search'}).fill('About');
  await page.getByRole('button',{name:/Atlas: About and updates/}).click();
  const dialog=page.getByRole('dialog',{name:'About Atlas'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('about-atlas-version')).not.toBeEmpty();
  await expect(dialog.getByTestId('about-fngk-bundled')).toHaveText('none (web host)');
  await expect(dialog.getByRole('button',{name:'Check for FNGK update'})).toBeVisible();
  await dialog.getByRole('button',{name:'Close About Atlas'}).click();
  await expect(dialog).toBeHidden();
});
