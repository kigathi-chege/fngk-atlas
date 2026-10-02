import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';

describe('desktop external-browser capability',()=>{
  it('permits only HTTPS URLs and never filesystem opening',async()=>{
    const capability=JSON.parse(await readFile(new URL('./src-tauri/capabilities/default.json',import.meta.url),'utf8'));
    expect(capability.permissions).toContainEqual({identifier:'opener:allow-open-url',allow:[{url:'https://*'}]});
    expect(JSON.stringify(capability.permissions)).not.toContain('open-path');
  });
});
