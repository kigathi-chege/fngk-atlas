import {describe, expect, it} from 'vitest';
import {createDeviceAppearanceStore} from '../../src/web/lib/device-appearance.js';

describe('DeviceAppearanceStore', () => {
  it('persists only named colors and notifies subscribers', () => {
    const storage = new Map<string, string>();
    const events: string[] = [];
    const store = createDeviceAppearanceStore({
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
      removeItem: key => void storage.delete(key),
    }, value => events.push(value));
    store.set('device:one', 'violet');
    expect(store.get('device:one')).toEqual({color: 'violet'});
    expect(events).toEqual(['device:one']);
    expect(() => store.set('device:one', 'not-a-color' as never)).toThrow('invalid_device_color');
    store.clear('device:one');
    expect(store.get('device:one')).toEqual({});
  });
});
