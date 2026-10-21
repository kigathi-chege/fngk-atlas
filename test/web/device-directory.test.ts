import { describe, expect, it } from 'vitest';
import { contextDisplayName, describeContext, rememberContexts } from '../../src/web/lib/device-directory.js';
import { resolveDeviceIdentity } from '../../src/web/lib/device-identity.js';

const deviceId = 'c8ef0ca9-6ca4-451d-adda-196a5546f7c3';

describe('device directory', () => {
  it('names a Device by its Atlas label and authoritative name, never its raw id', () => {
    rememberContexts([{ id: `device:${deviceId}`, name: 'kigathi', online: true }]);
    const identity = describeContext(`device:${deviceId}`);
    expect(identity).toMatchObject({ kind: 'device', label: resolveDeviceIdentity(deviceId).label, name: 'kigathi', online: true });
    expect(contextDisplayName(`device:${deviceId}`)).toBe(`${resolveDeviceIdentity(deviceId).label} · kigathi`);
    expect(contextDisplayName(`device:${deviceId}`)).not.toContain(deviceId);
  });

  it('describes the local context as this computer', () => {
    expect(describeContext('local')).toMatchObject({ kind: 'local', label: 'This computer' });
  });
});
