import {expect,test} from '@playwright/test';

test.setTimeout(45_000);

test('renders contextual search and safe filesystem actions in the FNGK Atlas workbench',async({page})=>{
  const errors:string[]=[],terminalSockets:string[]=[];page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});page.on('pageerror',error=>errors.push(error.message));page.on('websocket',socket=>{if(socket.url().includes('/api/fngk/terminals'))terminalSockets.push(socket.url())});
  await page.goto('/');await expect(page.getByText('FNGK Atlas',{exact:true}).first()).toBeVisible();await expect(page.locator('.dv-dockview')).toHaveCount(1);
  await expect(page.getByRole('navigation',{name:'Atlas activity'})).toBeVisible();await expect(page.getByRole('navigation',{name:'Pinned and workspace roots'})).toBeVisible();
  await page.getByRole('button',{name:'Search'}).first().click();await expect(page.getByLabel('Search Atlas')).toBeFocused();
  await expect(page.locator('.context-rail')).toBeVisible();await expect(page.getByText('Architecture',{exact:true}).first()).toBeVisible();await expect(page.getByText('Functions & coverage',{exact:true}).first()).toBeVisible();await expect(page.getByText('Filesystem',{exact:true}).first()).toBeVisible();await page.locator('.context-rail').getByRole('button',{name:'Atlas process host'}).click();
  await expect(page.getByRole('button',{name:/package\.json/})).toBeVisible();
  await page.getByRole('button',{name:/src/}).click({button:'right'});await page.getByRole('menuitem',{name:'Pin folder'}).click();const pinnedRoot=page.getByRole('button',{name:'Pinned /src'});await expect(pinnedRoot).toBeVisible();await pinnedRoot.click();await expect(page.getByRole('button',{name:/main\.ts/})).toBeVisible();await pinnedRoot.click({button:'right'});await page.getByRole('menuitem',{name:'Unpin folder'}).click();await expect(pinnedRoot).toHaveCount(0);await page.getByRole('button',{name:'Open filesystem'}).click();await expect(page.getByRole('button',{name:/package\.json/})).toBeVisible();
  await page.getByLabel('Search filesystem').fill('package');await expect(page.getByText('/package.json',{exact:true})).toBeVisible();await page.getByLabel('Search filesystem').fill('');
  const binary=page.locator('.tree-row',{hasText:'binary.dat'});await binary.click({button:'right'});await page.getByRole('menuitem',{name:'Move to trash'}).click();await page.getByRole('button',{name:'Move to trash'}).click();await expect(page.locator('.trash-notice')).toContainText('Restore');await page.locator('.trash-notice').getByRole('button',{name:'Restore'}).click();await expect(page.locator('.trash-notice')).toHaveCount(0);
  await page.getByRole('button',{name:/package\.json/}).click();
  await expect(page.locator('.cm-editor')).toBeVisible();await expect(page.locator('.cm-content')).toContainText('fngk-atlas');await expect(page.locator('.cm-gutters')).toBeVisible();
  await page.locator('.cm-content').click();await expect(page.locator('.cm-cursor')).toBeVisible();
  const openFilePanels=await page.locator('.file-panel').count();await page.keyboard.press('Control+Shift+s');await expect(page.getByRole('dialog',{name:/Save package\.json as/})).toBeVisible();await page.getByRole('dialog',{name:/Save package\.json as/}).getByRole('button',{name:'Cancel'}).click();await expect(page.locator('.file-panel')).toHaveCount(openFilePanels);
  await page.keyboard.press('Control+Shift+p');await page.getByLabel('Command search').fill('save as');await page.getByRole('button',{name:'File: Save As'}).click();await expect(page.getByRole('dialog',{name:/Save package\.json as/})).toBeVisible();await page.getByRole('dialog',{name:/Save package\.json as/}).getByRole('button',{name:'Cancel'}).click();
  await page.keyboard.press('Control+n');await expect(page.getByText('Untitled-1',{exact:true}).first()).toBeVisible();await page.locator('.file-panel:visible .cm-content').fill('export const draft = true;');await page.keyboard.press('Control+s');const saveAs=page.getByRole('dialog',{name:/Save Untitled-1 as/});await expect(saveAs).toBeVisible();await saveAs.getByLabel('Save directory').fill('/');await saveAs.getByLabel('Save filename').fill('draft.ts');await saveAs.getByRole('button',{name:'Create file'}).click();await expect(page.locator('.file-panel:visible header')).toContainText('Saved via direct');await expect(page.locator('.tree-row',{hasText:'draft.ts'})).toBeVisible();
  await page.getByTitle('Create file').click();const inlineName=page.getByLabel('New file name');await expect(inlineName).toBeFocused();await inlineName.fill('inline.ts');await inlineName.press('Enter');await expect(page.getByText('inline.ts',{exact:true}).first()).toBeVisible();await page.locator('.file-panel:visible .cm-content').fill('export const inline = true;');await page.keyboard.press('Control+s');await expect(page.locator('.file-panel:visible header')).toContainText('Saved via direct');await expect(page.locator('.tree-row',{hasText:'inline.ts'})).toBeVisible();
  await page.locator('.context-rail').getByRole('button',{name:/kigathi/}).click();await page.locator('.context-sidebar').getByRole('button',{name:'Open terminal',exact:true}).click();await expect(page.getByText('Terminal',{exact:true}).first()).toBeVisible();const visibleTerminal=page.locator('.terminal-panel:visible');await expect(visibleTerminal.locator('header')).toContainText('Live');const sessionRail=visibleTerminal.getByRole('navigation',{name:'Terminal sessions'});await expect(sessionRail).toBeVisible();await expect(sessionRail.locator('.session-label').first()).toBeVisible();expect(await sessionRail.evaluate(element=>getComputedStyle(element).overflowY)).toBe('auto');await expect(visibleTerminal.getByRole('button',{name:'New terminal session'})).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('atlas:open-terminal')));await page.evaluate(()=>window.dispatchEvent(new Event('atlas:open-terminal')));await expect(page.locator('.terminal-panel')).toHaveCount(1);expect(terminalSockets.filter(url=>url.includes('new=1'))).toHaveLength(0);
  await visibleTerminal.getByRole('button',{name:'New terminal session'}).click();await expect.poll(()=>terminalSockets.filter(url=>url.includes('new=1')).length).toBe(1);await expect(page.locator('.terminal-panel')).toHaveCount(1);
  const separators=page.locator('.dv-sash');expect(await separators.count()).toBeGreaterThan(1);
  await page.reload();await expect(page.locator('.dv-dockview')).toHaveCount(1);await expect(page.getByText('Filesystem',{exact:true}).first()).toBeVisible();
  await page.locator('.context-rail').getByRole('button',{name:'Atlas process host'}).click();await page.route('**/api/files/search?**',async route=>{await new Promise(resolve=>setTimeout(resolve,350));await route.fulfill({contentType:'application/json',body:JSON.stringify({matches:[{path:'/stale-file.txt',type:'file'}]})});});await page.getByLabel('Search filesystem').fill('stale');await page.locator('.context-rail').getByRole('button',{name:/kigathi/}).click();await page.waitForTimeout(600);await expect(page.getByText('/stale-file.txt',{exact:true})).toHaveCount(0);
  await page.route('**/api/search?**',async route=>{await new Promise(resolve=>setTimeout(resolve,350));await route.fulfill({contentType:'application/json',body:JSON.stringify({items:[{entityId:'stale',type:'function',label:'stale indexed result',path:'src/stale.ts',contextId:'local',repositoryRoot:'/safe-root'}]})});});await page.locator('.context-rail').getByRole('button',{name:'Atlas process host'}).click();await page.getByLabel('Search Atlas').fill('stale');await page.locator('.context-rail').getByRole('button',{name:/kigathi/}).click();await page.waitForTimeout(600);await expect(page.getByText('stale indexed result',{exact:true})).toHaveCount(0);
  for(let index=0;index<20;index++){
    const close=page.locator('.atlas-file-tab-close:visible').first();if(!await close.count())break;
    await close.click({force:true});
  }
  const minimizeFilesystem=page.getByRole('button',{name:'Minimize Filesystem'});if(await minimizeFilesystem.count())await minimizeFilesystem.click();
  const minimizeAtlas=page.getByRole('button',{name:'Minimize Atlas'});if(await minimizeAtlas.count())await minimizeAtlas.click();
  await expect(page.getByLabel('Restore Atlas panels')).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Atlas activity'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Pinned and workspace roots'})).toBeVisible();
  await page.getByRole('button',{name:'Open filesystem'}).click();
  await expect(page.getByText('Filesystem',{exact:true}).first()).toBeVisible();
  await page.locator('.tree-list').click({button:'right',position:{x:240,y:220}});await expect(page.getByRole('menuitem',{name:'Pin current folder'})).toBeVisible();await expect(page.getByRole('menuitem',{name:'Add workspace root'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('menuitem',{name:'Pin current folder'})).toHaveCount(0);
  const filesystemTab=page.getByRole('tab',{name:'Filesystem',exact:true});await filesystemTab.click({button:'right'});await page.getByRole('menuitem',{name:'Minimize'}).click();await expect(page.getByRole('button',{name:'Restore Filesystem'})).toBeVisible();await page.getByRole('button',{name:'Restore Filesystem'}).click();await expect(page.getByText('Filesystem',{exact:true}).first()).toBeVisible();expect(await page.evaluate(()=>document.querySelector('.tree-explorer')?.closest('.dv-groupview')!==document.querySelector('.graph-panel')?.closest('.dv-groupview'))).toBe(true);await page.getByRole('tab',{name:'Filesystem',exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'Float'}).click();await expect(page.locator('.dv-floating-overlay-host .dv-resize-container')).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps unsaved buffer bodies memory-only and drops stale restored tabs',async({page})=>{
  await page.goto('/');
  await page.keyboard.press('Control+n');
  await expect(page.getByText('Untitled-1',{exact:true}).first()).toBeVisible();
  await page.locator('.file-panel:visible .cm-content').fill('never-persist-this-buffer-body');
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('never-persist-this-buffer-body');
  await page.reload();
  await expect(page.getByText('Untitled-1',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'Atlas activity'})).toBeVisible();
});

test('keeps the persistent shell polished and reachable at desktop and narrow widths',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await page.locator('.context-rail').getByRole('button',{name:'Atlas process host'}).click();
  const unified=page.getByLabel('Search Atlas');await expect(unified).toBeVisible();await unified.fill('package');await expect(page.getByRole('listbox',{name:'Unified search results'})).toBeVisible();await expect(page.getByRole('option',{name:/package\.json/}).first()).toBeVisible();await page.keyboard.press('Escape');await page.locator('.atlas-shell').click({position:{x:400,y:400}});await page.keyboard.press('Control+k');await expect(unified).toBeFocused();await page.keyboard.press('Escape');
  const geometry=await page.evaluate(()=>{const left=document.querySelector('.context-sidebar')?.closest('.dv-groupview')?.getBoundingClientRect(),right=document.querySelector('.tree-explorer')?.closest('.dv-groupview')?.getBoundingClientRect(),center=document.querySelector('.graph-panel')?.closest('.dv-groupview')?.getBoundingClientRect(),sash=document.querySelector('.dv-sash');return {left:left?.width??0,right:right?.width??0,center:center?.width??0,grip:sash?getComputedStyle(sash,'::after').content:''}});expect(Math.abs(geometry.left-geometry.right)).toBeLessThanOrEqual(8);expect(geometry.center).toBeGreaterThan(geometry.left*1.5);expect(geometry.grip).toContain('•••');
  await page.keyboard.press('Control+Shift+p');
  const palette=page.getByRole('dialog',{name:'Command palette'});
  await expect(palette).toBeVisible();
  await expect(page.getByLabel('Command search')).toBeFocused();
  const desktop=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-window.innerWidth,paletteWidth:document.querySelector('.command-palette')?.getBoundingClientRect().width??0,palettePosition:getComputedStyle(document.querySelector('.palette-backdrop')!).position}));
  expect(desktop.overflow).toBeLessThanOrEqual(0);expect(desktop.paletteWidth).toBeGreaterThanOrEqual(420);expect(desktop.palettePosition).toBe('fixed');
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:620,height:760});
  await expect(page.getByRole('navigation',{name:'Atlas activity'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Pinned and workspace roots'})).toBeVisible();
  await expect(page.locator('.context-sidebar')).toBeHidden();
  await expect(page.locator('.tree-explorer')).toBeHidden();
  expect(await page.locator('.graph-panel').evaluate(element=>element.closest('.dv-groupview')?.getBoundingClientRect().width??0)).toBeGreaterThan(300);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0);
});
