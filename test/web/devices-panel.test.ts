import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');

describe('DevicesPanel persistent shortcuts',()=>{
  it('keeps device-scoped operations in a fixed bottom shortcut region',async()=>{
    const source=await readFile(resolve(root,'src/web/components/DevicesPanel.svelte'),'utf8');
    expect(source).toContain('class="device-shortcuts"');
    expect(source).toContain("shortcut('ports')");
    expect(source).toContain("shortcut('deployment')");
    expect(source).toContain("shortcut('database')");
    expect(source).toContain("shortcut('terminal')");
    expect(source).toContain("grid-template-rows:auto minmax(0,1fr) auto");
  });
});
