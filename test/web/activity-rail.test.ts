import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');

describe('ActivityRail',()=>{
 it('places the lifecycle entry above a scrollable Device context list',async()=>{
  const rail=await readFile(resolve(root,'src/web/components/ActivityRail.svelte'),'utf8');
  const css=await readFile(resolve(root,'src/web/enhancements.css'),'utf8');
  expect(rail).toContain('aria-label="Open Device lifecycle"');
  expect(rail).toContain('RailScrollViewport');
  expect(css).toContain('scrollbar-width:none');
 });
});
