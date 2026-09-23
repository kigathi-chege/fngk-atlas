import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';

describe('desktop runtime staging',()=>{
  it('installs only locked production dependencies instead of copying the development tree',async()=>{
    const script=await readFile(new URL('../../scripts/prepare-desktop-runtime.sh',import.meta.url),'utf8');
    expect(script).toContain('npm ci --omit=dev --ignore-scripts');
    expect(script).not.toContain('cp -a node_modules');
  });
});
