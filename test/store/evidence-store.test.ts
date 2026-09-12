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
    const replacement = store.beginScan({ contextId: 'host', routeId: 'terminal-1' });
    store.putEntities(replacement.id, [{ id: 'repo-2', contextId: 'host', type: 'repository', name: 'atlas', path: '/srv/atlas' }]);
    store.completeScan(replacement.id, { partial: false });
    expect(store.entities('host').map(value => value.id)).toEqual(['repo-2']);
    store.close();
  });
});
