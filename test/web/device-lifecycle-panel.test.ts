import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');
describe('Device lifecycle panel wiring',()=>{
 it('opens a dedicated lifecycle panel from the rail event',async()=>{
  const host=await readFile(resolve(root,'src/web/components/PanelHost.svelte'),'utf8');
  const workbench=await readFile(resolve(root,'src/web/components/Workbench.svelte'),'utf8');
  expect(host).toContain("'device-lifecycle':()=>import('./DeviceLifecyclePanel.svelte')");
  expect(workbench).toContain("atlas:open-device-lifecycle");
  expect(workbench).toContain("component:'device-lifecycle'");
 });
});
