import {readFile,readdir} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';

const capabilityDir=new URL('./src-tauri/capabilities/',import.meta.url);
const load=async(name:string)=>JSON.parse(await readFile(new URL(name,capabilityDir),'utf8'));

describe('desktop capabilities',()=>{
  it('permits only HTTPS URLs and never filesystem opening',async()=>{
    const capability=await load('loopback.json');
    expect(capability.permissions).toContainEqual({identifier:'opener:allow-open-url',allow:[{url:'https://*'}]});
    expect(JSON.stringify(capability.permissions)).not.toContain('open-path');
  });
  it('scopes the only capability to the loopback origin and grants no app commands',async()=>{
    expect(await readdir(capabilityDir)).toEqual(['loopback.json']);
    const capability=await load('loopback.json');
    expect(capability.windows).toEqual(['main']);
    expect(capability.remote).toEqual({urls:['http://127.0.0.1:*']});
    expect(capability.permissions.map((permission:any)=>typeof permission==='string'?permission:permission.identifier)).toEqual(['opener:allow-open-url']);
  });
});
