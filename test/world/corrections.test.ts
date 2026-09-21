import { describe, expect, it } from 'vitest';
import { WorldStore } from '../../src/world/store.js';
import { WorldService } from '../../src/world/service.js';

const seed = () => {
  const store = new WorldStore(':memory:'), world = new WorldService(store);
  world.refresh('local', [
    {id:'repo',type:'repository',label:'web',path:'/srv/web',repositoryPath:'/srv/web'},
    {id:'process',type:'process',label:'node',metadata:{cwd:'/srv/web',processState:'S'}},
  ], [], {name:'Device',online:true});
  const workload = store.entities('local').find(entity => entity.kind === 'workload' && entity.attributes.visibility === 'primary');
  if (!workload) throw new Error('Fixture workload missing');
  return {store,world,workload};
};

describe('explicit semantic corrections', () => {
  it('overrides presentation without changing derived evidence and resets cleanly', () => {
    const {store,world,workload} = seed();
    const original = store.entity(workload.id)!;
    world.putCorrection('local',workload.id,'rename','Customer portal');
    world.putCorrection('local',workload.id,'purpose','Serves customers');
    world.putCorrection('local',workload.id,'group','data');
    const item = world.projection('local',{lens:'overview'}).observatory!.regions.flatMap(region=>region.items).find(item=>item.id===workload.id);
    expect(item).toMatchObject({label:'Customer portal',purpose:'Serves customers'});
    expect(world.detail(workload.id)?.entity).toMatchObject({label:'Customer portal',attributes:expect.objectContaining({region:'data'})});
    expect(world.detail(workload.id)?.assertions).toContainEqual(expect.objectContaining({classification:'user-defined',predicate:'has-purpose'}));
    expect(store.entity(workload.id)?.entity).toEqual(original.entity);
    expect(world.corrections('local',workload.id)).toHaveLength(3);
    world.deleteCorrections('local',workload.id);
    expect(world.detail(workload.id)?.entity?.label).toBe(original.entity?.label);
    expect(world.detail(workload.id)?.assertions.some(assertion=>assertion.classification==='user-defined')).toBe(false);
    store.close();
  });
  it('ignores one entity only and validates split/merge targets in-context', () => {
    const {store,world,workload} = seed();
    expect(()=>world.putCorrection('local',workload.id,'merge','missing')).toThrow();
    expect(()=>world.putCorrection('other',workload.id,'rename','bad')).toThrow();
    world.putCorrection('local',workload.id,'ignore',true);
    expect(world.projection('local',{lens:'overview'}).observatory!.regions.flatMap(region=>region.items).some(item=>item.id===workload.id)).toBe(false);
    expect(store.entity(workload.id)).not.toBeNull();
    world.deleteCorrections('local',workload.id);
    expect(world.projection('local',{lens:'overview'}).observatory!.regions.flatMap(region=>region.items).some(item=>item.id===workload.id)).toBe(true);
    store.close();
  });
  it('splits an explicit technical member into a stable new workload and keeps it inspectable',()=>{
    const {store,world,workload}=seed(),member=store.entities('local').find(entity=>entity.workloadId===workload.id);
    expect(member).toBeDefined();
    world.putCorrection('local',workload.id,'split',{memberIds:[member!.id],label:'Separate worker'});
    const split=world.projection('local',{lens:'overview'}).observatory!.regions.flatMap(region=>region.items).find(item=>item.label==='Separate worker');
    expect(split).toBeDefined();
    expect(world.detail(split!.id)?.entity?.label).toBe('Separate worker');
    expect(world.projection('local',{lens:'runtime',level:3}).nodes.find(node=>node.id===member!.id)?.workloadId).toBe(split!.id);
    store.close();
  });
  it('preserves a user correction through a derived-world refresh',()=>{
    const {store,world,workload}=seed();
    world.putCorrection('local',workload.id,'rename','My workload');
    world.refresh('local', [
      {id:'repo',type:'repository',label:'web',path:'/srv/web',repositoryPath:'/srv/web'},
      {id:'process',type:'process',label:'node',metadata:{cwd:'/srv/web',processState:'S'}},
    ], [], {name:'Device',online:true});
    expect(world.detail(workload.id)?.entity?.label).toBe('My workload');
    expect(store.entity(workload.id)?.entity?.label).not.toBe('My workload');
    store.close();
  });
  it('merges only two explicit workloads and retains source evidence',()=>{
    const {store,world,workload}=seed();
    world.refresh('local',[
      {id:'repo',type:'repository',label:'web',path:'/srv/web',repositoryPath:'/srv/web'},
      {id:'process',type:'process',label:'node',metadata:{cwd:'/srv/web',processState:'S'}},
      {id:'repo:api',type:'repository',label:'api',path:'/srv/api',repositoryPath:'/srv/api'},
      {id:'process:api',type:'process',label:'node',metadata:{cwd:'/srv/api',processState:'S'}},
    ],[],{name:'Device',online:true});
    const target=store.entities('local').find(entity=>entity.kind==='workload'&&entity.id!==workload.id&&entity.attributes.visibility==='primary');
    expect(target).toBeDefined();
    world.putCorrection('local',workload.id,'merge',target!.id);
    const items=world.projection('local',{lens:'overview'}).observatory!.regions.flatMap(region=>region.items);
    expect(items.some(item=>item.id===workload.id)).toBe(false);
    expect(items.some(item=>item.id===target!.id)).toBe(true);
    expect(world.detail(workload.id)?.assertions).toContainEqual(expect.objectContaining({predicate:'merged-into',objectId:target!.id,classification:'user-defined'}));
    expect(store.entity(workload.id)).not.toBeNull();
    store.close();
  });
});
