import {describe, expect, it} from 'vitest';
import {createAtlasEventStore} from '../../src/web/lib/atlas-events.js';
import {NotifyBridge} from '../../src/web/lib/notify-bridge.js';

describe('NotifyBridge', () => {
  it('is a working local-only state without a configured publisher', async () => {
    const events = createAtlasEventStore();
    const bridge = new NotifyBridge(events);
    await bridge.start();
    expect(bridge.connectionState()).toEqual({mode: 'local', connected: false, queued: 0});
    await bridge.flush();
  });

  it('keeps an allow-listed event visible in the outbox after retryable failure', async () => {
    const events = createAtlasEventStore();
    events.begin({id: 'event-1', type: 'filesystem.list', title: 'Files'});
    const bridge = new NotifyBridge(events, {publish: async () => { throw new Error('offline'); }});
    await bridge.start();
    await bridge.flush();
    expect(bridge.connectionState()).toMatchObject({mode: 'bridge', connected: false, queued: 1});
    expect(events.snapshot()).toEqual(expect.arrayContaining([expect.objectContaining({id: 'event-1', state: 'warning'})]));
  });

  it('does not publish unregistered event types or persist bridge credentials', async () => {
    const events = createAtlasEventStore();
    events.begin({id: 'unsafe', type: 'terminal.raw-output', title: 'Private output'});
    const calls: unknown[] = [];
    const bridge = new NotifyBridge(events, {publish: async event => { calls.push(event); }});
    await bridge.start();
    await bridge.flush();
    expect(calls).toEqual([]);
    expect(events.snapshot()[0]).toMatchObject({state: 'warning'});
  });
});
