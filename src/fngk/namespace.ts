import { NAMESPACE_PROTOCOL, type NamespaceSnapshot } from './protocol.js';

export function parseNamespace(raw: string): NamespaceSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('FNGK returned invalid namespace JSON.'), { code: 'invalid_json' });
  }
  if (!value || typeof value !== 'object') {
    throw Object.assign(new Error('FNGK returned an invalid namespace document.'), { code: 'invalid_namespace' });
  }
  const document = value as Record<string, unknown>;
  if (document.protocolVersion !== NAMESPACE_PROTOCOL) {
    throw Object.assign(new Error(`Unsupported FNGK namespace protocol: ${String(document.protocolVersion ?? 'missing')}`), { code: 'unsupported_protocol' });
  }
  if (!document.profile || typeof document.profile !== 'object' || !Array.isArray(document.devices) || !Array.isArray(document.connections) || !Array.isArray(document.sessions)) {
    throw Object.assign(new Error('FNGK namespace document is missing required collections.'), { code: 'invalid_namespace' });
  }
  return document as unknown as NamespaceSnapshot;
}
