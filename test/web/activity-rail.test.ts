import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');

describe('ActivityRail',()=>{
 it('keeps global actions fixed because Devices belong in the sidebar',async()=>{
  const rail=await readFile(resolve(root,'src/web/components/ActivityRail.svelte'),'utf8');
  const css=await readFile(resolve(root,'src/web/enhancements.css'),'utf8');
  expect(rail).toContain('class="activity-rail-top"');
  expect(rail).not.toContain('class="activity-rail-devices"');
  expect(rail).toContain('class="activity-rail-bottom"');
  expect(rail).toContain('aria-label="Open Device lifecycle"');
  expect(rail).toContain('aria-label="Open Observability"');
  expect(rail).toContain('aria-label="Open Devices"');
  expect(css).toContain('.activity-rail-top,.activity-rail-bottom{flex:none}');
 });
});
