import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');

describe('PanelHost loading state',()=>it('uses the shared status component for lazy panels',async()=>{
  const source=await readFile(resolve(root,'src/web/components/PanelHost.svelte'),'utf8');
  expect(source).toContain("import LoadingState from './LoadingState.svelte'");
  expect(source).toContain('<LoadingState message="Loading panel…"');
}));
