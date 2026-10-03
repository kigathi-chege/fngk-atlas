import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');
describe('Device Sessions presentation',()=>it('shows connection telemetry without terminal output or command history',async()=>{
  const source=await readFile(resolve(root,'src/web/components/DeviceSessionsPanel.svelte'),'utf8');
  expect(source).toContain('Persistent scoped FNGK connections and their active streams.');
  expect(source).toContain('Atlas internal connection');
  expect(source).not.toContain('scrollback');
  expect(source).not.toContain('command output');
}));
