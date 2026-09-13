import {describe,expect,it} from 'vitest';
import {UnifiedSearchCollection,type UnifiedSearchProvider} from '../../src/web/lib/unified-search.js';

describe('unified Atlas search collection',()=>{
  it('merges providers into one stable context-scoped collection with provenance',async()=>{
    const indexed:UnifiedSearchProvider=async()=>[
      {id:'file:/src/app.ts',type:'file',label:'app.ts',contextId:'device:one',path:'/src/app.ts',provenance:'index',score:20},
      {id:'fn:render',type:'function',label:'render',contextId:'device:one',path:'/src/app.ts',provenance:'index',score:50},
    ];
    const live:UnifiedSearchProvider=async()=>[
      {id:'file:/src/app.ts',type:'file',label:'app.ts',contextId:'device:one',path:'/src/app.ts',provenance:'live-files',score:40},
      {id:'file:/other.ts',type:'file',label:'other.ts',contextId:'device:two',path:'/other.ts',provenance:'live-files',score:100},
    ];
    const collection=new UnifiedSearchCollection([indexed,live]);
    const result=await collection.search({query:'app',contextId:'device:one',scope:'context'});
    expect(result.items.map(item=>[item.id,item.provenance])).toEqual([['fn:render','index'],['file:/src/app.ts','live-files']]);
  });

  it('marks superseded asynchronous results as stale',async()=>{
    let release:()=>void=()=>{};
    const slow:UnifiedSearchProvider=async request=>{if(request.query==='first')await new Promise<void>(resolve=>release=resolve);return [{id:request.query,type:'command',label:request.query,provenance:'commands'}]};
    const collection=new UnifiedSearchCollection([slow]);
    const first=collection.search({query:'first',contextId:'local',scope:'context'});
    const second=await collection.search({query:'second',contextId:'local',scope:'context'});
    release();
    expect(second.stale).toBe(false);expect(second.items[0].label).toBe('second');expect((await first).stale).toBe(true);
  });
});
