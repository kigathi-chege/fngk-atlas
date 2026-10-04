import {describe, expect, it} from 'vitest';
import {createDeviceLabelStore, resolveDeviceIdentity} from '../../src/web/lib/device-identity.js';

const deviceId = 'C43A7F25-2AC4-42C7-A15D-0ECFB7E77F6B';

describe('Atlas Device identity', () => {
  it('derives a stable one-word identity from a canonical UUID', () => {
    const first = resolveDeviceIdentity(deviceId);
    const second = resolveDeviceIdentity(deviceId.toLowerCase());
    expect(first).toEqual(second);
    expect(first.deviceId).toBe(deviceId.toLowerCase());
    expect(first.label).toMatch(/^[A-Z][a-z]+$/);
    expect(first.glyph).toMatch(/^[A-Z]{1,2}$/);
  });

  it('uses a safe fallback identity when the Device ID is invalid', () => {
    expect(resolveDeviceIdentity('not-a-device')).toMatchObject({deviceId: 'not-a-device', label: 'Device'});
  });

  it('persists only local label overrides and notifies subscribers', () => {
    const values = new Map<string, string>();
    const changes: string[] = [];
    const store = createDeviceLabelStore({
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
      removeItem: key => void values.delete(key),
    });
    const unsubscribe = store.subscribe(device => changes.push(device));
    store.setLabel(deviceId, 'Orbit');
    expect(store.getLabel(deviceId)).toBe('Orbit');
    expect(JSON.stringify([...values.values()])).not.toMatch(/token|secret|password/i);
    store.clearLabel(deviceId);
    expect(store.getLabel(deviceId)).toBeUndefined();
    expect(changes).toEqual([deviceId.toLowerCase(), deviceId.toLowerCase()]);
    unsubscribe();
  });

  it('recovers from malformed saved label preferences', () => {
    let removed = false;
    const store = createDeviceLabelStore({getItem: () => '{bad', setItem: () => {}, removeItem: () => { removed = true; }});
    expect(store.getLabel(deviceId)).toBeUndefined();
    expect(removed).toBe(true);
  });
});
