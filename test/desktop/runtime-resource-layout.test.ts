import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';

describe('desktop runtime resource layout',()=>{
  it('keeps the packaged runtime in its own named resource directory',async()=>{
    const config=JSON.parse(await readFile(new URL('../../desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8'));
    expect(config.bundle.resources['../runtime/']).toBe('runtime');
  });
});
