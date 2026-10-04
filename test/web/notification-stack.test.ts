import {describe, expect, it} from 'vitest';
import {noticeFromAtlasEvent} from '../../src/web/lib/notifications.js';
import type {AtlasEvent} from '../../src/web/lib/atlas-events.js';

const event = (state: AtlasEvent['state']): AtlasEvent => ({
  id: `event-${state}`, type: 'terminal.command', title: 'Terminal command', state,
  createdAt: '2026-10-04T00:00:00.000Z', source: 'local', pinned: false,
});

describe('notification event projection', () => {
  it('only toasts outcomes that need immediate attention', () => {
    expect(noticeFromAtlasEvent(event('pending'))).toBeUndefined();
    expect(noticeFromAtlasEvent(event('success'))).toMatchObject({level: 'success'});
    expect(noticeFromAtlasEvent(event('warning'))).toMatchObject({level: 'info'});
    expect(noticeFromAtlasEvent(event('error'))).toMatchObject({level: 'error'});
    expect(noticeFromAtlasEvent(event('cancelled'))).toBeUndefined();
  });

  it('subscribes to the retained event stream without replaying its full history as toasts', async () => {
    const {readFile}=await import('node:fs/promises');const {resolve}=await import('node:path');
    const source=await readFile(resolve(import.meta.dirname,'../../src/web/components/NotificationStack.svelte'),'utf8');
    expect(source).toContain('atlasEvents.subscribe');
    expect(source).toContain('hydrated=true');
  });
});
