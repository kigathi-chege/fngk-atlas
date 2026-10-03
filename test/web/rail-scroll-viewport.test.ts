import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
const root=resolve(import.meta.dirname,'../..');
describe('RailScrollViewport',()=>it('measures overflow and provides accessible directional buttons',async()=>{
 const source=await readFile(resolve(root,'src/web/components/RailScrollViewport.svelte'),'utf8');
 expect(source).toContain('ResizeObserver');
 expect(source).toContain('Show earlier Devices');
 expect(source).toContain('Show later Devices');
 expect(source).toContain('scrollBy');
}));
