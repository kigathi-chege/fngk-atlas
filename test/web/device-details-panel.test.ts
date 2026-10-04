import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root=resolve(import.meta.dirname,'../..');
describe('DeviceDetailsPanel', () => it('uses Atlas local identity and never renames the remote FNGK device', async () => {
  const source=await readFile(resolve(root,'src/web/components/DeviceDetailsPanel.svelte'),'utf8');
  expect(source).toContain('resolveDeviceIdentity');
  expect(source).toContain('deviceLabelStore.setLabel');
  expect(source).toContain("new Event('atlas:open-device-lifecycle')");
  expect(source).not.toContain('/api/devices/rename');
}));

describe('DeviceLifecyclePanel observability', () => it('records lifecycle action outcomes without recording command content', async () => {
  const source=await readFile(resolve(root,'src/web/components/DeviceLifecyclePanel.svelte'),'utf8');
  expect(source).toContain("import {atlasEvents}");
  expect(source).toContain("type:'device.lifecycle'");
  expect(source).toContain('atlasEvents.resolve(eventId');
  expect(source).toContain('atlasEvents.fail(eventId');
}));
