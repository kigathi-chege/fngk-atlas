import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');

describe('FilePanel loading state',()=>it('shows the shared loader while a file is opening',async()=>{
  const source=await readFile(resolve(root,'src/web/components/FilePanel.svelte'),'utf8');
  expect(source).toContain("status='Opening file…'");
  expect(source).toContain('<LoadingState message="Opening file…"');
}));
