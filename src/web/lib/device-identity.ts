import {atlasDeviceColors, type AtlasDeviceColor} from './device-appearance.js';

export type AtlasDeviceIdentity = {
  deviceId: string;
  label: string;
  glyph: string;
  color: AtlasDeviceColor;
  version: 1;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const identityKey = 'atlas.device-labels.v1';
const labels = ['Aster', 'Birch', 'Cinder', 'Dawn', 'Ember', 'Flint', 'Grove', 'Harbor', 'Iris', 'Juniper', 'Kestrel', 'Lumen', 'Morrow', 'Nova', 'Orbit', 'Pine', 'Quartz', 'Raven', 'Solace', 'Tundra', 'Vale', 'Willow', 'Zephyr'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const canonical = (value: string) => value.trim().toLowerCase();
const hash = (value: string) => {
  let result = 0x811c9dc5;
  for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 0x01000193); }
  return result >>> 0;
};

export function resolveDeviceIdentity(deviceId: string): AtlasDeviceIdentity {
  const normalized = canonical(deviceId);
  if (!uuidPattern.test(normalized)) return {deviceId: normalized, label: 'Device', glyph: 'D', color: 'cyan', version: 1};
  const value = hash(normalized);
  const label = labels[value % labels.length];
  return {deviceId: normalized, label, glyph: label.slice(0, 2).toUpperCase(), color: atlasDeviceColors[(value >>> 8) % atlasDeviceColors.length], version: 1};
}

export function createDeviceLabelStore(storage: StorageLike) {
  let values: Record<string, string> = {};
  const listeners = new Set<(deviceId: string) => void>();
  try {
    const parsed = JSON.parse(storage.getItem(identityKey) ?? '{}');
    if (parsed && typeof parsed === 'object') values = Object.fromEntries(Object.entries(parsed).filter(([deviceId, label]) => uuidPattern.test(canonical(deviceId)) && typeof label === 'string' && /^[A-Za-z][A-Za-z -]{0,30}$/.test(label.trim())).map(([deviceId, label]) => [canonical(deviceId), (label as string).trim()]));
  } catch { storage.removeItem(identityKey); }
  const publish = (deviceId: string) => listeners.forEach(listener => listener(deviceId));
  const persist = () => storage.setItem(identityKey, JSON.stringify(values));
  return {
    getLabel(deviceId: string) { return values[canonical(deviceId)]; },
    setLabel(deviceId: string, label: string) {
      const id = canonical(deviceId), next = label.trim();
      if (!uuidPattern.test(id) || !/^[A-Za-z][A-Za-z -]{0,30}$/.test(next)) throw new Error('invalid_device_label');
      values = {...values, [id]: next}; persist(); publish(id);
    },
    clearLabel(deviceId: string) {
      const id = canonical(deviceId); if (!(id in values)) return;
      const {[id]: _, ...next} = values; values = next; persist(); publish(id);
    },
    subscribe(listener: (deviceId: string) => void) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

const memoryStorage: StorageLike = {getItem: () => null, setItem: () => {}, removeItem: () => {}};
export const deviceLabelStore = createDeviceLabelStore(typeof localStorage === 'undefined' ? memoryStorage : localStorage);
