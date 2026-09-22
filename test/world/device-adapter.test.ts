import {describe,expect,it} from 'vitest';
import {runDeviceAdapter,validateDeviceAdapter,type DeviceAdapterManifest} from '../../src/world/device-adapter.js';
import {WorldStore} from '../../src/world/store.js';
import {WorldService} from '../../src/world/service.js';

const manifest:DeviceAdapterManifest={protocolVersion:'atlas.device-adapter.v1',id:'example.postgres',version:'1.0.0',publisher:'example',displayName:'PostgreSQL probe',command:"printf '%s\\n' '{\"kind\":\"process\",\"label\":\"postgres\",\"sourceId\":\"42\"}'",timeoutMs:1000,maxRecords:10,interpreter:{protocolVersion:'atlas.interpreter.v1',ontologyVersion:'atlas.world.v2',id:'example.postgres.interpreter',version:'1.0.0',publisher:'example',displayName:'PostgreSQL semantics',inputs:['process'],outputKinds:['workload','capability'],outputPredicates:['provides-capability'],rules:[{id:'postgres',when:{all:[{field:'label',op:'contains',value:'postgres'}]},emit:{kind:'workload',capability:'relational-storage',confidence:.98,explanation:'The adapter observed a PostgreSQL process.'}}]}};
describe('Device adapter protocol',()=>{
 it('runs a bounded JSONL probe and feeds its declarative interpreter',async()=>{const commands:string[]=[],executor={execute:async(command:string,options?:{timeoutMs?:number})=>{commands.push(`${command}:${options?.timeoutMs}`);return{output:Buffer.from('{"kind":"process","label":"postgres","sourceId":"42"}\n'),exitCode:0}}},result=await runDeviceAdapter(manifest,executor,'device:one');expect(commands).toEqual([`${manifest.command}:1000`]);expect(result.inputs).toHaveLength(1);expect(result.output.entities).toEqual(expect.arrayContaining([expect.objectContaining({kind:'workload'}),expect.objectContaining({kind:'capability'})]));expect(result.output.assertions[0]).toMatchObject({predicate:'provides-capability',classification:'derived'})});
 it('rejects unsafe budgets and malformed JSONL',async()=>{expect(validateDeviceAdapter({...manifest,timeoutMs:31_000})).toMatchObject({ok:false});await expect(runDeviceAdapter(manifest,{execute:async()=>({output:Buffer.from('not-json\n'),exitCode:0})},'local')).rejects.toMatchObject({code:'adapter_protocol_error'})});
 it('never persists adapter secret attributes in entities or search',async()=>{
   const executor={execute:async()=>({output:Buffer.from(JSON.stringify({kind:'process',label:'postgres',sourceId:'42',attributes:{pid:42,cwd:'/srv/db',privateKey:'adapter-secret',metadata:{databaseUrl:'postgres://user:adapter-secret@host/db'}}})+'\n'),exitCode:0})};
   const result=await runDeviceAdapter(manifest,executor,'local'),store=new WorldStore(':memory:');
   new WorldService(store).ingest(manifest.interpreter,result.inputs);
   const persisted=JSON.stringify(store.db.prepare('SELECT attributes_json FROM atlas_world_entities').all())+JSON.stringify(store.db.prepare('SELECT detail FROM atlas_world_search').all());
   expect(persisted).not.toContain('adapter-secret');
   expect(result.output.entities.find(item=>item.kind==='workload')?.attributes).toMatchObject({pid:42,cwd:'/srv/db'});
   store.close();
 });
 it('sanitizes direct semantic ingest before reinterpreting adapter inputs',()=>{
   const store=new WorldStore(':memory:');
   new WorldService(store).ingest(manifest.interpreter,[{id:'adapter:direct',contextId:'local',kind:'process',label:'postgres',source:'device-adapter:test',observedAt:'2026-09-20T00:00:00Z',attributes:{pid:42,privateKey:'direct-secret'}}]);
   const persisted=JSON.stringify(store.db.prepare('SELECT attributes_json FROM atlas_world_entities').all());
   expect(persisted).not.toContain('direct-secret');
   expect(store.entities('local').find(item=>item.kind==='workload')?.attributes.pid).toBe(42);
   store.close();
 });
});
