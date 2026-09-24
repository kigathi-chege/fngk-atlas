export interface SafeWorkspacePanel {
  id: string;
  minimized?: boolean;
  kind?: string;
  title?: string;
  params?: Record<string, unknown>;
}

export interface SafeWorkspaceSnapshot {
  version: number;
  layout: unknown;
  panels?: SafeWorkspacePanel[];
}

type ReadableStorage = Pick<Storage, 'getItem'> | Map<string, string>;
type WritableStorage = Pick<Storage, 'setItem'> | Map<string, string>;

const valueFor = (storage: ReadableStorage, key: string) => storage instanceof Map ? storage.get(key) ?? null : storage.getItem(key);
const store = (storage: WritableStorage, key: string, value: string) => storage instanceof Map ? storage.set(key, value) : storage.setItem(key, value);

export function createWorkspacePersistenceKey(profile: string | undefined, contextId: string | undefined) {
  return `atlas.workspace.v1:${encodeURIComponent(profile || 'default')}:${encodeURIComponent(contextId || 'local')}`;
}

export function readWorkspaceSnapshot(storage: ReadableStorage, profile?: string, contextId?: string): SafeWorkspaceSnapshot | undefined {
  const raw = valueFor(storage, createWorkspacePersistenceKey(profile, contextId));
  if (!raw) return undefined;
  try {
    const candidate = JSON.parse(raw);
    if (!candidate || candidate.version !== 1 || !('layout' in candidate)) return undefined;
    const panels = Array.isArray(candidate.panels)
      ? (candidate.panels as unknown[]).map(safePanel).filter((panel): panel is SafeWorkspacePanel => panel !== undefined)
      : undefined;
    return { version: 1, layout: sanitizeWorkspaceLayout(candidate.layout), ...(panels ? { panels } : {}) };
  } catch {
    return undefined;
  }
}

export function writeWorkspaceSnapshot(storage: WritableStorage, profile: string | undefined, contextId: string | undefined, snapshot: SafeWorkspaceSnapshot) {
  const panels = snapshot.panels?.map(safePanel).filter((panel): panel is SafeWorkspacePanel => panel !== undefined);
  const value: SafeWorkspaceSnapshot = { version: 1, layout: sanitizeWorkspaceLayout(snapshot.layout), ...(panels?.length ? { panels } : {}) };
  store(storage, createWorkspacePersistenceKey(profile, contextId), JSON.stringify(value));
}

const safePanelKeys = new Set(['contextId', 'path', 'line', 'sessionId', 'session', 'panelId', 'targetContextId', 'repositoryPath', 'view', 'diagnosticId', 'target', 'profile', 'bufferId', 'root', 'lens', 'indexId']);

function safePanel(panel: unknown): SafeWorkspacePanel | undefined {
  if (!panel || typeof panel !== 'object' || typeof (panel as { id?: unknown }).id !== 'string') return undefined;
  const candidate = panel as { id: string; minimized?: unknown; kind?: unknown; title?: unknown; params?: Record<string, unknown> };
  const params = Object.fromEntries(Object.entries(candidate.params ?? {}).filter(([key, value]) => safePanelKeys.has(key) && ['string', 'number', 'boolean'].includes(typeof value)));
  return { id: candidate.id, ...(typeof candidate.minimized === 'boolean' ? {minimized:candidate.minimized} : {}), ...(typeof candidate.kind === 'string' ? { kind: candidate.kind } : {}), ...(typeof candidate.title === 'string' ? { title: candidate.title } : {}), ...(Object.keys(params).length ? { params } : {}) };
}

// Dockview nests the same runtime params inside its serialized layout.
export function sanitizeWorkspaceLayout(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeWorkspaceLayout);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'params' ? safePanel({id:'layout',params:item})?.params ?? {} : sanitizeWorkspaceLayout(item)
  ]));
}
