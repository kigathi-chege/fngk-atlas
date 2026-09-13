import path from 'node:path';import {afterEach,describe,expect,it} from 'vitest';import {discoverDatabases} from '../../src/databases/discovery.js';import {DbGateSupervisor} from '../../src/databases/sidecar.js';
const runtimes:DbGateSupervisor[]=[];afterEach(async()=>{while(runtimes.length)await runtimes.pop()!.close()});
describe('database resources and DbGate isolation',()=>{
  it('discovers engine-neutral candidates without reading credentials and tolerates probe failure',async()=>{
    const value=await discoverDatabases('device:1',{execute:async()=>({output:Buffer.from('LISTEN 0 128 127.0.0.1:5432 users:(("postgres",pid=4))\nLISTEN 0 128 127.0.0.1:6379 users:(("redis-server",pid=5))'),exitCode:0})});
    expect(value.items).toEqual(expect.arrayContaining([expect.objectContaining({engine:'postgres',port:5432,source:'terminal'}),expect.objectContaining({engine:'redis',port:6379})]));expect(JSON.stringify(value)).not.toMatch(/password|credential/i);
    await expect(discoverDatabases('device:1',{execute:async()=>{throw new Error('permission denied')}})).resolves.toMatchObject({items:[],errors:[{probe:'database-census'}]});
  });
  it('runs a patched sidecar as non-root and exposes only redacted session metadata',async()=>{
    const runtime=new DbGateSupervisor({command:process.execPath,args:[path.resolve('test/fixtures/dbgate-sidecar.mjs')],version:'7.2.3',uid:1000,ttlMs:5000});runtimes.push(runtime);
    const value=await runtime.start({contextId:'local',engine:'postgres',host:'127.0.0.1',port:5432,user:'atlas',password:'never-return-this',readOnly:true});
    expect(value.session).toMatchObject({status:'live',engine:'postgres',proxyPath:expect.stringContaining('/workbench/')});expect(JSON.stringify(runtime.list())).not.toContain('never-return-this');expect(value.token).toBeTruthy();
  });
  it('refuses vulnerable or root sidecars',async()=>{
    await expect(new DbGateSupervisor({command:'node',version:'7.1.8',uid:1000}).start({contextId:'local',engine:'postgres',host:'localhost'})).rejects.toMatchObject({code:'unsafe_sidecar_version'});
    await expect(new DbGateSupervisor({command:'node',version:'7.2.3',uid:0}).start({contextId:'local',engine:'postgres',host:'localhost'})).rejects.toMatchObject({code:'sidecar_root_denied'});
  });
});
