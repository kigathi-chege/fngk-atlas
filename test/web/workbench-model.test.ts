import { describe, expect, it } from 'vitest';
import { WorkbenchModel } from '../../src/web/lib/workbench-model.js';

describe('workbench documents', () => {
  it('reuses one preview file until editing pins it', () => {
    const model = new WorkbenchModel();
    const first = model.openFile({ contextId: 'local', path: '/a.ts' });
    const second = model.openFile({ contextId: 'local', path: '/b.ts' });
    expect(first.id).toBe(second.id); expect(model.panels()).toHaveLength(1); expect(second.preview).toBe(true);
    model.markDirty(second.id, true);
    expect(model.panel(second.id)).toMatchObject({ preview: false, dirty: true });
    const third = model.openFile({ contextId: 'local', path: '/c.ts' });
    expect(third.id).not.toBe(second.id); expect(model.panels()).toHaveLength(2);
  });

  it('persists descriptors and layout without buffer contents', () => {
    const model = new WorkbenchModel(); const panel = model.openFile({ contextId: 'local', path: '/secret.ts' }, true); model.markDirty(panel.id, true);
    const saved = model.serialize({ dock: 'layout' });
    expect(saved.layout).toEqual({ dock: 'layout' }); expect(saved.panels).toHaveLength(1); expect(saved.panels[0]).toMatchObject({ resource: { contextId: 'local', path: '/secret.ts' }, dirty: true });
    expect(JSON.stringify(saved)).not.toContain('buffer');
  });

  it('never aliases identical paths from different machine contexts', () => {
    const model=new WorkbenchModel(),local=model.openFile({contextId:'local',path:'/etc/config'});model.markDirty(local.id,true);
    const remote=model.openFile({contextId:'device:one',path:'/etc/config'});
    expect(remote.id).not.toBe(local.id);expect(model.panels()).toHaveLength(2);
  });
});
