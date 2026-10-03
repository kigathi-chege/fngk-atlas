import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');

describe('ActivityRail',()=>{
 it('separates fixed workspace actions from the scrollable Device list',async()=>{
  const rail=await readFile(resolve(root,'src/web/components/ActivityRail.svelte'),'utf8');
  const css=await readFile(resolve(root,'src/web/enhancements.css'),'utf8');
  expect(rail).toContain('class="activity-rail-top"');
  expect(rail).toContain('class="activity-rail-devices"');
  expect(rail).toContain('class="activity-rail-bottom"');
  expect(rail).toContain('aria-label="Open Device lifecycle"');
  expect(rail).toContain('RailScrollViewport');
  expect(rail.indexOf('activity-rail-top')).toBeLessThan(rail.indexOf('activity-rail-devices'));
  expect(rail.indexOf('activity-rail-devices')).toBeLessThan(rail.indexOf('activity-rail-bottom'));
  expect(css).toContain('scrollbar-width:none');
  expect(css).toContain('.activity-rail-top,.activity-rail-bottom{flex:none}');
  expect(css).toContain('.activity-rail-devices{flex:1;min-height:0}');
 });
});
