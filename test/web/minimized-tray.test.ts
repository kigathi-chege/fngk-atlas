import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');

describe('shared minimized-panel rail',()=>{
  it('uses the right rail for every minimized panel and never renders a terminal-only dock',async()=>{
    const [app,rail]=await Promise.all([
      readFile(resolve(root,'src/web/App.svelte'),'utf8'),
      readFile(resolve(root,'src/web/components/PinnedRootsRail.svelte'),'utf8'),
    ]);
    expect(app).not.toContain('TerminalDock');
    expect(rail).not.toContain("item.kind!=='terminal'");
    expect(rail).not.toContain("item.id!=='atlas.navigator'");
    expect(rail).toContain('visibleCount={7}');
  });

  it('renders seven direct typed icons and places later panels in typed overflow',async()=>{
    const tray=await readFile(resolve(root,'src/web/components/MinimizedTray.svelte'),'utf8');
    expect(tray).toContain('visibleCount=7');
    expect(tray).toContain('function panelIcon');
    expect(tray).toContain('item.kind');
    expect(tray).toContain('hidden.length');
    expect(tray).toContain('role="menu"');
  });

  it('routes Operations minimization through the standard panel lifecycle',async()=>{
    const workbench=await readFile(resolve(root,'src/web/components/Workbench.svelte'),'utf8');
    const body=workbench.match(/const minimizeOperations=.*?;\n    const confirm=/s)?.[0]??'';
    expect(body).toContain('minimizePanel(panel)');
    expect(body).not.toContain('dock.removePanel(remaining)');
  });
});
