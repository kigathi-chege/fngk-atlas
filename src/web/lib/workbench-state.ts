export interface Selection { id: string; type: string; path?: string; line?: number; [key: string]: unknown }
export interface WorkbenchSnapshot {
  contextId: string;
  contextExplicit: boolean;
  connection: { phase: 'checking' | 'connected' | 'authentication-required' | 'unavailable'; message: string; profile?: string; version?: string };
  selection?: Selection;
  activity: string[];
  layout?: { central?: unknown; bottom?: unknown };
}

export function createWorkbenchState(initial: Partial<WorkbenchSnapshot> = {}) {
  let value: WorkbenchSnapshot = { contextId: initial.contextId ?? 'local', contextExplicit: initial.contextExplicit === true, connection: { phase: 'checking', message: 'Discovering installed FNGK…' }, activity: [], layout: initial.layout };
  let cursor = -1;
  const history: Selection[] = [];
  const listeners = new Set<(snapshot: WorkbenchSnapshot) => void>();
  const publish = () => listeners.forEach(listener => listener({ ...value, activity: [...value.activity] }));
  return {
    snapshot: () => ({ ...value, activity: [...value.activity] }),
    subscribe(listener: (snapshot: WorkbenchSnapshot) => void) { listeners.add(listener); listener({ ...value, activity: [...value.activity] }); return () => listeners.delete(listener); },
    select(selection: Selection) { history.splice(cursor + 1); history.push(selection); cursor = history.length - 1; value = { ...value, selection }; publish(); },
    back() { if (cursor > 0) { cursor--; value = { ...value, selection: history[cursor] }; publish(); } },
    forward() { if (cursor + 1 < history.length) { cursor++; value = { ...value, selection: history[cursor] }; publish(); } },
    setContext(contextId: string, explicit = true) { value = { ...value, contextId, contextExplicit: explicit || value.contextExplicit }; publish(); },
    setConnection(connection: WorkbenchSnapshot['connection']) { value = { ...value, connection }; publish(); },
    setLayout(layout: WorkbenchSnapshot['layout']) { value = { ...value, layout }; publish(); },
    appendActivity(message: string) { value = { ...value, activity: [...value.activity.slice(-199), message] }; publish(); },
    persistable: () => ({ version: 2, contextId: value.contextId, contextExplicit: value.contextExplicit, selection: value.selection, layout: value.layout }),
  };
}

export type WorkbenchState = ReturnType<typeof createWorkbenchState>;

export function chooseContext(contexts: Array<{ id: string; kind?: string; online?: boolean }>, snapshot: Pick<WorkbenchSnapshot, 'contextId' | 'contextExplicit'>): string {
  if (snapshot.contextExplicit && contexts.some(context => context.id === snapshot.contextId)) return snapshot.contextId;
  return contexts.find(context => context.kind === 'fngk-device' && context.online)?.id ?? contexts.find(context => context.id === 'local')?.id ?? contexts[0]?.id ?? 'local';
}
