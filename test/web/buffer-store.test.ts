import {describe,expect,it} from 'vitest';import {BufferStore} from '../../src/web/lib/buffer-store.js';

describe('editor buffer store',()=>{
  it('creates uniquely named memory-only drafts and tracks dirty content',()=>{
    const store=new BufferStore();const first=store.create({contextId:'local'}),second=store.create({contextId:'local'});
    expect([first.name,second.name]).toEqual(['Untitled-1','Untitled-2']);expect(first.dirty).toBe(false);
    store.update(first.id,'const privateDraft = true;');
    expect(store.get(first.id)).toMatchObject({content:'const privateDraft = true;',dirty:true});expect(store.hasDirty()).toBe(true);
    expect(JSON.stringify(store.persistable())).not.toContain('privateDraft');
  });

  it('binds a saved resource without changing immutable buffer identity',()=>{
    const store=new BufferStore(),draft=store.create({contextId:'device:one',suggestedDirectory:'/srv/app',proposedPath:'/srv/app/new.ts'});
    store.update(draft.id,'export const value=1');store.bindResource(draft.id,{contextId:'device:one',path:'/srv/app/new.ts',fingerprint:'sha256'});
    expect(store.get(draft.id)).toMatchObject({id:draft.id,name:'new.ts',dirty:false,resource:{path:'/srv/app/new.ts',fingerprint:'sha256'}});
    store.remove(draft.id);expect(store.get(draft.id)).toBeUndefined();
  });

  it('does not consume Untitled numbering for explicitly named copy buffers',()=>{
    const store=new BufferStore();
    store.create({contextId:'local',proposedPath:'/repo/package-copy.json',content:'{}'});
    expect(store.create({contextId:'local'}).name).toBe('Untitled-1');
  });
});
