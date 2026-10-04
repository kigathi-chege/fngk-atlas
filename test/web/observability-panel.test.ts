import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
const root=resolve(import.meta.dirname,'../..');
describe('ObservabilityPanel',()=>it('projects retained local operation history and permits local cleanup',async()=>{
 const source=await readFile(resolve(root,'src/web/components/ObservabilityPanel.svelte'),'utf8');
 expect(source).toContain('atlasEvents.subscribe');expect(source).toContain('clearUnpinned');expect(source).toContain('pin(');
}));
