export const atlasDeviceColors = ['cyan', 'violet', 'amber', 'emerald', 'rose', 'blue'] as const;
export type AtlasDeviceColor = typeof atlasDeviceColors[number];
export type DeviceAppearance = {color?: AtlasDeviceColor};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = 'atlas.device-appearance.v1';

function valid(value: unknown): value is AtlasDeviceColor {
  return typeof value === 'string' && (atlasDeviceColors as readonly string[]).includes(value);
}

export function createDeviceAppearanceStore(storage: StorageLike, changed: (deviceId: string) => void = () => {}) {
  let values: Record<string, DeviceAppearance> = {};
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '{}');
    if (parsed && typeof parsed === 'object') values = Object.fromEntries(Object.entries(parsed).filter(([id, value]) => id && value && typeof value === 'object' && (!('color' in value) || valid((value as DeviceAppearance).color))));
  } catch { storage.removeItem(key); }
  const persist = () => storage.setItem(key, JSON.stringify(values));
  return {
    get(deviceId: string): DeviceAppearance { return {...(values[deviceId] ?? {})}; },
    set(deviceId: string, color: AtlasDeviceColor): void {
      if (!valid(color)) throw new Error('invalid_device_color');
      values = {...values, [deviceId]: {color}}; persist(); changed(deviceId);
    },
    clear(deviceId: string): void { if (!(deviceId in values)) return; const {[deviceId]: _, ...next} = values; values = next; persist(); changed(deviceId); },
  };
}

const memoryStorage: StorageLike = {getItem: () => null, setItem: () => {}, removeItem: () => {}};
const browserStorage = typeof localStorage === 'undefined' ? memoryStorage : localStorage;
export const deviceAppearanceStore = createDeviceAppearanceStore(browserStorage, deviceId => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('atlas:device-appearance-changed', {detail: {deviceId}}));
});
