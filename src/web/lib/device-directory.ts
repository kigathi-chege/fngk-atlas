import {writable, get} from 'svelte/store';
import {deviceLabelStore, resolveDeviceIdentity} from './device-identity.js';
import {deviceAppearanceStore, type AtlasDeviceColor} from './device-appearance.js';

/** What the UI shows for a context instead of its raw id. */
export type ContextIdentity = {contextId: string; kind: 'local' | 'device' | 'other'; label: string; name: string; glyph: string; color?: AtlasDeviceColor; online?: boolean};

type Known = {name?: string; online?: boolean};
/** Names and presence from the last context catalog, keyed by context id. */
export const deviceDirectory = writable<Record<string, Known>>({});

export function rememberContexts(contexts: Array<{id: string; name?: string; online?: boolean}>) {
  deviceDirectory.update(current => {
    const next = {...current};
    for (const context of contexts) next[context.id] = {name: context.name, online: context.online};
    return next;
  });
}

export function describeContext(contextId: string, known: Record<string, Known> = get(deviceDirectory)): ContextIdentity {
  const entry = known[contextId];
  if (contextId === 'local') return {contextId, kind: 'local', label: 'This computer', name: entry?.name ?? 'Atlas process host', glyph: '⌂', online: true};
  if (!contextId.startsWith('device:')) return {contextId, kind: 'other', label: contextId || 'No context', name: '', glyph: '·'};
  const deviceId = contextId.slice('device:'.length), identity = resolveDeviceIdentity(deviceId);
  return {contextId, kind: 'device', label: deviceLabelStore.getLabel(deviceId) ?? identity.label, name: entry?.name ?? '', glyph: identity.glyph, color: deviceAppearanceStore.get(deviceId).color ?? identity.color, online: entry?.online};
}

/** Plain text for places that cannot hold a chip (options, sentences, titles). */
export function contextDisplayName(contextId: string): string {
  const value = describeContext(contextId);
  return value.name && value.name !== value.label ? `${value.label} · ${value.name}` : value.label;
}

export const openDevice = (contextId: string) => window.dispatchEvent(new CustomEvent('atlas:open-device', {detail: {contextId}}));
