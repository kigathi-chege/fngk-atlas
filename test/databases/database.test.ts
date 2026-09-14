import path from 'node:path';import {afterEach,describe,expect,it,vi} from 'vitest';import {discoverDatabases} from '../../src/databases/discovery.js';import {DbGateSupervisor} from '../../src/databases/sidecar.js';import {RoutedDatabaseRuntime} from '../../src/databases/routed-runtime.js';import {FngkTcpRelayProvider} from '../../src/fngk/tcp-relay.js';
import {DbGateContainerSupervisor} from '../../src/databases/container-sidecar.js';
const runtimes:DbGateSupervisor[]=[];afterEach(async()=>{while(runtimes.length)await runtimes.pop()!.close()});
describe('database resources and DbGate isolation',()=>{
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
  it('runs a patched sidecar as non-root and exposes only redacted session metadata',async()=>{
    const runtime=new DbGateSupervisor({command:process.execPath,args:[path.resolve('test/fixtures/dbgate-sidecar.mjs')],version:'7.2.3',uid:1000,ttlMs:5000});runtimes.push(runtime);
    const value=await runtime.start({contextId:'local',engine:'postgres',host:'127.0.0.1',port:5432,user:'atlas',password:'never-return-this',readOnly:true});
    expect(value.session).toMatchObject({status:'live',engine:'postgres',proxyPath:expect.stringContaining('/workbench/')});expect(JSON.stringify(runtime.list())).not.toContain('never-return-this');expect(value.token).toBeTruthy();
  });
  it('refuses vulnerable or root sidecars',async()=>{
    await expect(new DbGateSupervisor({command:'node',version:'7.1.8',uid:1000}).start({contextId:'local',engine:'postgres',host:'localhost'})).rejects.toMatchObject({code:'unsafe_sidecar_version'});
    await expect(new DbGateSupervisor({command:'node',version:'7.2.3',uid:0}).start({contextId:'local',engine:'postgres',host:'localhost'})).rejects.toMatchObject({code:'sidecar_root_denied'});
  });
  it('requires an exact patched tag for container sidecars',async()=>{
    const connection={contextId:'local',engine:'postgres' as const,host:'127.0.0.1',port:5432};
    await expect(new DbGateContainerSupervisor({image:'dbgate/dbgate:7.1.8'}).start(connection)).rejects.toMatchObject({code:'unsafe_sidecar_version'});
    await expect(new DbGateContainerSupervisor({image:'dbgate/dbgate:latest'}).start(connection)).rejects.toMatchObject({code:'unsafe_sidecar_version'});
  });
  it('routes remote database bytes through the selected FNGK profile and tears the relay down',async()=>{
    let received:any,closed=0;const session:any={id:'db-1',contextId:'device:one',engine:'postgres',label:'db',status:'live',createdAt:'now',expiresAt:'later',proxyPath:'/db/'};
    const inner:any={start:vi.fn(async(connection)=>{received=connection;return {session,token:'token',origin:'http://db'}}),list:()=>[session],get:()=>({session,token:'token',origin:'http://db'}),stop:vi.fn(async()=>true),close:vi.fn(async()=>{})};
    const fngk:any={binary:'fngk',env:{},probe:async()=>({compatible:true,profile:'local'})},relays:any={start:vi.fn(async()=>({host:'127.0.0.1',port:41111,target:'device:one',targetPort:5432,profile:'local',close:async()=>{closed++}}))};
    const runtime=new RoutedDatabaseRuntime(inner,fngk,relays);const value=await runtime.start({contextId:'device:one',engine:'postgres',host:'127.0.0.1',port:5432});
    expect(received).toMatchObject({host:'127.0.0.1',port:41111});expect(relays.start).toHaveBeenCalledWith('device:one',5432,{profile:'local'});expect(value.session).toMatchObject({accessRoute:'fngk-tcp',target:{host:'127.0.0.1',port:5432}});await runtime.stop('db-1');expect(closed).toBe(1);
  });
  it('consumes versioned FNGK TCP relay readiness',async()=>{const relay=await new FngkTcpRelayProvider({binary:path.resolve('test/fixtures/fngk.mjs'),env:{FNGK_FIXTURE_MODE:'ok'}}).start('device:one',5432,{profile:'local'});expect(relay).toMatchObject({host:'127.0.0.1',port:32123,target:'device:one',targetPort:5432,profile:'local'});await relay.close()});
  it('identifies human relay readiness as an outdated installed CLI',async()=>{
    await expect(new FngkTcpRelayProvider({binary:path.resolve('test/fixtures/fngk.mjs'),env:{FNGK_FIXTURE_MODE:'human-tcp'}}).start('device:one',5432,{profile:'local'})).rejects.toMatchObject({code:'incompatible_cli',message:expect.stringContaining('exact-head FNGK')});
  });
});
