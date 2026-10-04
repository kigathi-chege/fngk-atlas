import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');

describe('DevicesPanel persistent shortcuts',()=>{
  it('renders a scrollable card grid and delegates device actions to the details panel',async()=>{
    const source=await readFile(resolve(root,'src/web/components/DevicesPanel.svelte'),'utf8');
    expect(source).toContain('class="device-card"');
    expect(source).toContain('oncontextmenu');
    expect(source).toContain('.devices-list{overflow:auto');
    expect(source).not.toContain('class="device-shortcuts"');
  });

  it('puts selected-device actions and color selection in DeviceDetailsPanel',async()=>{
    const source=await readFile(resolve(root,'src/web/components/DeviceDetailsPanel.svelte'),'utf8');
    expect(source).toContain('class="device-shortcuts"');
    expect(source).toContain('atlas:open-ports');
    expect(source).toContain('atlas:open-deployment');
    expect(source).toContain('atlas:open-database');
    expect(source).toContain('atlas:open-terminal');
    expect(source).toContain('atlasDeviceColors');
  });
});
