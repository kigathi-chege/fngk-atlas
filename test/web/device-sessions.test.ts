import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('Device Sessions workspace panel', () => {
  it('projects scoped session telemetry and lifecycle actions into a dockable panel', async () => {
    const [panel, host, workbench, rail, store] = await Promise.all([
      readFile(resolve(root, 'src/web/components/DeviceSessionsPanel.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/PanelHost.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/Workbench.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/ActivityRail.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/lib/device-session-store.ts'), 'utf8'),
    ]);
    expect(panel).toContain('Device Sessions');
    expect(panel).toContain('activeStreams');
    expect(panel).toContain('handshakeCount');
    expect(panel).toContain("act('reconnect'");
    expect(panel).toContain("act('cache/clear'");
    expect(panel).toContain("act('revoke'");
    expect(host).toContain("'device-sessions':()=>import('./DeviceSessionsPanel.svelte')");
    expect(workbench).toContain("atlas:open-device-sessions");
    expect(workbench).toContain("component:'device-sessions'");
    expect(rail).toContain('aria-label="Open Device Sessions"');
    expect(store).toContain('/api/device-sessions');
  });
});
