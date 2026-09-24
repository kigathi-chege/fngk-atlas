import { describe, expect, it } from 'vitest';
import { createWorkspacePersistenceKey, readWorkspaceSnapshot, writeWorkspaceSnapshot } from '../../src/web/lib/workspace-persistence.js';

describe('workspace persistence', () => {
  it('strips runtime payloads from nested Dockview params and preserves minimized state', () => {
    const storage = new Map<string, string>();
    writeWorkspaceSnapshot(storage, 'work', 'local', {version:1, layout:{version:7,layout:{panels:{terminal:{id:'terminal',params:{session:'abc',profile:'work',token:'secret',content:'private',newSession:true}}}}},panels:[{id:'terminal',minimized:true} as any]});
    const saved = readWorkspaceSnapshot(storage,'work','local') as any;
    expect(saved.layout.layout.panels.terminal.params).toEqual({session:'abc',profile:'work'});
    expect(saved.panels[0].minimized).toBe(true);
  });
  it('scopes a safe layout to the active FNGK profile and context', () => {
    const storage = new Map<string, string>();
    const key = createWorkspacePersistenceKey('work', 'device:alpha');
    storage.set(key, JSON.stringify({ version: 1, layout: { dock: 'alpha' }, panels: [{ id: 'terminal', params: { sessionId: 'safe' } }], terminalOutput: 'secret' }));

    expect(key).toBe('atlas.workspace.v1:work:device%3Aalpha');
    expect(readWorkspaceSnapshot(storage, 'work', 'device:alpha')).toEqual({ version: 1, layout: { dock: 'alpha' }, panels: [{ id: 'terminal', params: { sessionId: 'safe' } }] });
    expect(readWorkspaceSnapshot(storage, 'other', 'device:alpha')).toBeUndefined();
  });

  it('writes only the safe workspace contract', () => {
    const storage = new Map<string, string>();

    writeWorkspaceSnapshot(storage, 'work', 'local', {
      version: 1,
      layout: { dock: 'layout' },
      panels: [{ id: 'terminal', params: { sessionId: 'session-1', token: 'secret', nested: { unsafe: true } } }],
      terminalOutput: 'do not persist'
    } as any);

    expect(JSON.parse(storage.get(createWorkspacePersistenceKey('work', 'local'))!)).toEqual({
      version: 1,
      layout: { dock: 'layout' },
      panels: [{ id: 'terminal', params: { sessionId: 'session-1' } }]
    });
  });
});
