import {describe,expect,it} from 'vitest';
import {WorkspaceRootsStore} from '../../src/web/lib/workspace-roots.js';

describe('workspace roots',()=>{
  it('keeps pins and workspace roots distinct, deduplicated, and context scoped',()=>{
    const store=new WorkspaceRootsStore();
    store.pin({contextId:'device:one',path:'/srv/app'});
    store.pin({contextId:'device:one',path:'/srv/app'});
    store.addWorkspace({contextId:'device:one',path:'/srv/app'});
    store.pin({contextId:'device:two',path:'/srv/app'});

    expect(store.forContext('device:one')).toEqual([
      {contextId:'device:one',path:'/srv/app',kind:'pinned'},
      {contextId:'device:one',path:'/srv/app',kind:'workspace'},
    ]);
    expect(store.forContext('device:two')).toEqual([{contextId:'device:two',path:'/srv/app',kind:'pinned'}]);
  });

  it('restores only safe records and removes one semantic root without affecting the other',()=>{
    const store=new WorkspaceRootsStore([
      {contextId:'local',path:'/safe',kind:'pinned'},
      {contextId:'local',path:'/safe',kind:'workspace'},
      {contextId:'local',path:'relative',kind:'pinned'},
      {contextId:'local',path:'/secret',kind:'unknown' as 'pinned',token:'do-not-store'} as any,
    ]);

    store.unpin({contextId:'local',path:'/safe'});

    expect(store.persistable()).toEqual([{contextId:'local',path:'/safe',kind:'workspace'}]);
    store.removeWorkspace({contextId:'local',path:'/safe'});
    expect(store.persistable()).toEqual([]);
  });
});
