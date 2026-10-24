import {describe, expect, it} from 'vitest';
import {createAtlasEventStore, type AtlasEvent} from '../../src/web/lib/atlas-events.js';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const pending = (id = 'run-1'): Partial<AtlasEvent> => ({
  id,
  type: 'filesystem.list',
  title: 'Loading files',
  state: 'pending',
  contextId: 'device:abc',
  correlationId: 'correlation-1',
  metadata: {token: 'never persist', path: '/srv'},
});

describe('AtlasEventStore', () => {
  it('replaces one lifecycle record in place and keeps its correlation data', () => {
    const store = createAtlasEventStore();
    store.begin(pending());
    store.resolve('run-1', {message: 'Loaded 8 entries'});
    expect(store.snapshot()).toEqual([expect.objectContaining({
      id: 'run-1', state: 'success', message: 'Loaded 8 entries', correlationId: 'correlation-1',
    })]);
  });

  it('retains every lifecycle outcome until the operator explicitly clears or deletes it', () => {
    const store = createAtlasEventStore();
    store.begin({...pending('pinned'), title: 'Keep this'});
    store.pin('pinned');
    for (let index = 0; index < 4; index += 1) store.begin({...pending(`run-${index}`), title: `Run ${index}`});
    expect(store.snapshot().map(event => event.id)).toContain('pinned');
    expect(store.snapshot()).toHaveLength(5);
  });

  it('retains remote events regardless of their producer version metadata', () => {
    const store = createAtlasEventStore();
    store.upsertRemote({...pending('remote-old'), state: 'error', metadata: {producerVersion: '0.0.1', route: 'terminal'}});
    expect(store.snapshot()).toEqual([expect.objectContaining({
      id: 'remote-old', source: 'remote', state: 'error', metadata: {producerVersion: '0.0.1', route: 'terminal'},
    })]);
  });

  it('retains an event state introduced by a newer Atlas version as a visible warning', () => {
    const storage = new MemoryStorage();
    storage.setItem('atlas.events.v1', JSON.stringify([{
      ...pending('remote-new'), source: 'remote', state: 'recovering', metadata: {producerVersion: '99.0.0'},
    }]));
    expect(createAtlasEventStore(storage).snapshot()).toEqual([expect.objectContaining({
      id: 'remote-new', state: 'warning', metadata: {producerVersion: '99.0.0', reportedState: 'recovering'},
    })]);
  });

  it('recovers from malformed persistence and never writes sensitive metadata', () => {
    const storage = new MemoryStorage();
    storage.setItem('atlas.events.v1', '{bad');
    const recovered = createAtlasEventStore(storage);
    expect(recovered.snapshot()).toEqual([]);
    expect(storage.getItem('atlas.events.v1')).toBeNull();
    recovered.begin(pending());
    expect(storage.getItem('atlas.events.v1')).not.toContain('never persist');
    expect(storage.getItem('atlas.events.v1')).not.toContain('token');
  });

  it('clears only local unpinned history and leaves remote/pinned records intact', () => {
    const store = createAtlasEventStore();
    store.begin(pending('local'));
    store.upsertRemote({...pending('remote'), source: 'remote'});
    store.begin(pending('pinned'));
    store.pin('pinned');
    store.clearUnpinned();
    expect(store.snapshot().map(event => event.id)).toEqual(expect.arrayContaining(['remote', 'pinned']));
    expect(store.snapshot().map(event => event.id)).not.toContain('local');
  });

  it('cancels local work left pending when Atlas last closed, so it never shows as running', () => {
    const storage = new MemoryStorage();
    createAtlasEventStore(storage).begin(pending('interrupted') as any);
    const [event] = createAtlasEventStore(storage).snapshot();
    expect(event).toMatchObject({id: 'interrupted', state: 'cancelled', message: 'Atlas closed before this finished.'});
  });

  it('keeps the history bounded, dropping the oldest finished events but never running or pinned ones', () => {
    const store = createAtlasEventStore();
    store.begin(pending('still-running') as any);
    store.begin({...pending('pinned-old'), state: 'success'} as any); store.pin('pinned-old');
    for (let index = 0; index < 420; index += 1) store.begin({...pending(`done-${index}`), state: 'success'} as any);
    const ids = store.snapshot().map(event => event.id);
    expect(ids).toHaveLength(400);
    expect(ids).toEqual(expect.arrayContaining(['still-running', 'pinned-old', 'done-419']));
    expect(ids).not.toContain('done-0');
  });
});
