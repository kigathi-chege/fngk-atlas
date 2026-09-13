import { describe, expect, it } from 'vitest';
import { EvidenceStore } from '../../src/store/evidence-store.js';

describe('evidence store', () => {
  it('persists provenance and relationships but rejects raw file bodies', () => {
    const store = new EvidenceStore(':memory:');
    const scan = store.beginScan({ contextId: 'host', routeId: 'terminal-1' });
    store.putEntities(scan.id, [{ id: 'repo-1', contextId: 'host', type: 'repository', name: 'signal', path: '/srv/signal', metadata: { token: 'must-redact', content: 'must-not-store' } }]);
    store.putRelationships(scan.id, [{ id: 'contains-1', contextId: 'host', type: 'contains', sourceId: 'host', targetId: 'repo-1', evidence: { routeId: 'terminal-1' } }]);
    store.completeScan(scan.id, { partial: false });
    expect(store.entities('host')).toEqual([expect.objectContaining({ id: 'repo-1', metadata: { token: '[redacted]' } })]);
    expect(store.relationships('host')).toEqual([expect.objectContaining({ sourceId: 'host', targetId: 'repo-1' })]);
    expect(JSON.stringify(store.entities('host'))).not.toContain('must-not-store');
    expect(store.search('host','signal')).toContainEqual(expect.objectContaining({entityId:'repo-1',type:'repository'}));
    const replacement = store.beginScan({ contextId: 'host', routeId: 'terminal-1' });
    store.putEntities(replacement.id, [{ id: 'repo-2', contextId: 'host', type: 'repository', name: 'atlas', path: '/srv/atlas' }]);
    store.completeScan(replacement.id, { partial: false });
    expect(store.entities('host').map(value => value.id)).toEqual(['repo-2']);
    expect(store.search('host','signal')).toEqual([]);
    store.invalidateContext('host', 'terminal_disconnected');
    expect(store.entities('host')).toEqual([expect.objectContaining({ id: 'repo-2', stale: true, staleReason: 'terminal_disconnected' })]);
    expect(store.search('host','atlas')).toEqual([expect.objectContaining({ entityId: 'repo-2', stale: true, staleReason: 'terminal_disconnected' })]);
    const refreshed = store.beginScan({ contextId: 'host', routeId: 'terminal-2' });
    store.putEntities(refreshed.id, [{ id: 'repo-2', contextId: 'host', type: 'repository', name: 'atlas', path: '/srv/atlas' }]);
    store.completeScan(refreshed.id, { partial: false });
    expect(store.entities('host')).toEqual([expect.objectContaining({ id: 'repo-2', stale: false })]);
    store.recordOperation({id:'op-1',type:'file.trash',contextId:'host',route:{id:'terminal-1',kind:'terminal',effectiveIdentity:'uid:0',privilege:'root'},summary:{path:'/srv/atlas/a.txt',token:'must-redact'},recordedAt:'2026-09-13T00:00:00.000Z'});
    expect(store.operations('host')).toEqual([expect.objectContaining({id:'op-1',type:'file.trash',summary:{path:'/srv/atlas/a.txt',token:'[redacted]'}})]);
    expect(store.search('host','trash')).toContainEqual(expect.objectContaining({entityId:'op-1',type:'operation'}));
    store.close();
  });
});
