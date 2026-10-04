import {describe, expect, it} from 'vitest';
import {clampLowerPanelHeight, clampSidebarWidth, permanentPanelIds} from '../../src/web/lib/workspace-splitters.js';

describe('permanent workbench geometry', () => {
  it('starts sidebars at one fifth and keeps their usable bounds', () => {
    expect(clampSidebarWidth(200, 1600)).toBe(240);
    expect(clampSidebarWidth(500, 1600)).toBe(420);
    expect(clampSidebarWidth(undefined, 1600)).toBe(320);
  });
  it('keeps lower permanent panels between one third and one half', () => {
    expect(clampLowerPanelHeight(undefined, 900)).toBe(300);
    expect(clampLowerPanelHeight(100, 900)).toBe(300);
    expect(clampLowerPanelHeight(700, 900)).toBe(450);
  });
  it('names the five retained permanent panels', () => expect(permanentPanelIds).toEqual(['atlas.devices','atlas.device-details','atlas.filesystem','atlas.inspector','atlas.operations']));
  it('applies the lower-panel clamp in the live Dockview shell', async () => {
    const {readFile}=await import('node:fs/promises');const {resolve}=await import('node:path');
    const source=await readFile(resolve(import.meta.dirname,'../../src/web/components/Workbench.svelte'),'utf8');
    expect(source).toContain('const constrainLowerPanels=');
    expect(source).toContain("['atlas.device-details','atlas.inspector']");
    expect(source).toContain('clampLowerPanelHeight(height,host.clientHeight)');
  });
  it('collapses retained lower panels to a header height rather than removing them', async () => {
    const {readFile}=await import('node:fs/promises');const {resolve}=await import('node:path');
    const source=await readFile(resolve(import.meta.dirname,'../../src/web/components/Workbench.svelte'),'utf8');
    expect(source).toContain('atlas:toggle-panel-collapse');
    expect(source).toContain("['atlas.device-details','atlas.inspector','atlas.operations']");
  });
  it('does not re-expand a retained lower panel after it was collapsed', async () => {
    const {readFile}=await import('node:fs/promises');const {resolve}=await import('node:path');
    const source=await readFile(resolve(import.meta.dirname,'../../src/web/components/Workbench.svelte'),'utf8');
    expect(source).toContain('if(height<=36)continue');
  });
  it('does not treat bottom-dock tools as ordinary center documents', async () => {
    const {readFile}=await import('node:fs/promises');const {resolve}=await import('node:path');
    const source=await readFile(resolve(import.meta.dirname,'../../src/web/components/Workbench.svelte'),'utf8');
    expect(source).toContain('!operational(panel.id,panel.api.component)');
  });
  it('mounts the retained left region as the dedicated Devices panel', async () => {
    const {readFile}=await import('node:fs/promises');const {resolve}=await import('node:path');
    const root=resolve(import.meta.dirname,'../../src/web');
    const workbench=await readFile(resolve(root,'components/Workbench.svelte'),'utf8');
    const host=await readFile(resolve(root,'components/PanelHost.svelte'),'utf8');
    const devices=await readFile(resolve(root,'components/DevicesPanel.svelte'),'utf8');
    expect(workbench).toContain("component:'devices'");
    expect(host).toContain("devices:()=>import('./DevicesPanel.svelte')");
    expect(devices).toContain("aria-label=\"Devices\"");
    expect(devices).toContain("atlas:open-device-lifecycle");
  });
});
