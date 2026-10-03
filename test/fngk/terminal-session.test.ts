import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');
describe('Terminal ownership metadata',()=>it('defaults new terminal transports to internal ownership and exposes immutable purpose metadata',async()=>{
  const source=await readFile(resolve(root,'src/fngk/terminal-session.ts'),'utf8');
  expect(source).toContain("export type TerminalOwner = 'atlas-user' | 'atlas-internal'");
  expect(source).toContain("this.owner = options.owner ?? 'atlas-internal'");
  expect(source).toContain("this.purpose = options.purpose ?? 'diagnostic'");
}));
