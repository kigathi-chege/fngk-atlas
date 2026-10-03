import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
const root=resolve(import.meta.dirname,'../..');
describe('Workbench file previews',()=>it('uses preview metadata and italic titles instead of preview text',async()=>{
 const [workbench, css]=await Promise.all([readFile(resolve(root,'src/web/components/Workbench.svelte'),'utf8'),readFile(resolve(root,'src/web/enhancements.css'),'utf8')]);
 expect(workbench).toContain('preview:!resource.pinned');
 expect(workbench).not.toContain(' · preview');
 expect(css).toContain('.atlas-file-tab.preview .atlas-file-tab-title{font-style:italic}');
}));
