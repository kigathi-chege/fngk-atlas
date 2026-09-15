import {describe,expect,it} from 'vitest';import {discoverDatabases} from '../../src/databases/discovery.js';
describe('native database resource discovery',()=>{
  it('discovers engine-neutral candidates without reading credentials and tolerates probe failure',async()=>{
    const value=await discoverDatabases('device:1',{execute:async()=>({output:Buffer.from('LISTEN 0 128 127.0.0.1:5432 users:(("postgres",pid=4))\nLISTEN 0 128 127.0.0.1:6379 users:(("redis-server",pid=5))'),exitCode:0})});
    expect(value.items).toEqual(expect.arrayContaining([expect.objectContaining({engine:'postgres',port:5432,source:'terminal'}),expect.objectContaining({engine:'redis',port:6379})]));expect(JSON.stringify(value)).not.toMatch(/password|credential/i);
    await expect(discoverDatabases('device:1',{execute:async()=>{throw new Error('permission denied')}})).resolves.toMatchObject({items:[],errors:[{probe:'database-census'}]});
  });
  it('merges native adapter evidence while keeping terminal discovery authoritative',async()=>{
    const native=[{id:'resource-1',deviceId:'1',name:'PostgreSQL :5432',kind:'postgres.instance',status:'online',availability:'available',provenance:'discovered',capabilities:['database.query.read'],attributes:{host:'127.0.0.1',port:5432},lastObservedAt:'2026-09-13T00:00:00Z'}];
    const value=await discoverDatabases('device:1',{execute:async()=>({output:Buffer.from('LISTEN 0 128 127.0.0.1:5432 users:(("postgres",pid=4))'),exitCode:0})},native);
    expect(value.items).toHaveLength(1);expect(value.items[0]).toMatchObject({source:'terminal',engine:'postgres',evidence:{nativeResourceId:'resource-1',terminal:true}});
    const fallback=await discoverDatabases('device:1',undefined,native);expect(fallback.items[0]).toMatchObject({source:'adapter',engine:'postgres'});expect(fallback.errors).toEqual([{probe:'database-census',message:'No terminal command route was available.'}]);
  });
});
