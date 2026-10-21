import type { AtlasCommandRegistry } from '../command-registry.js';

/** The slice of the Workbench's Dockview that git panels need. */
export interface GitPanelHost {
  dock: { getPanel(id: string): any; addPanel(options: any): any };
  /** The panel new center tabs dock beside. */
  reference(): any;
  restore(id: string): void;
  registry: { get(id: string): { minimized?: boolean } | undefined };
  syncEmpty(): void;
  remember?(panel: any): void;
}

export interface SourceControlRequest { contextId?: string; root?: string }
export interface GitDiffRequest { contextId: string; path: string; view?: 'working' | 'staged' }

const SOURCE_CONTROL = 'atlas.source-control';

/**
 * Opens Source Control and diff panels on `atlas:open-source-control` and
 * `atlas:open-git-diff`. Kept out of Workbench.svelte so it only needs one
 * line to install and one to dispose.
 */
export function installGitPanels(host: GitPanelHost): () => void {
  const openSourceControl = (event: Event) => {
    const detail = ((event as CustomEvent<SourceControlRequest>).detail ?? {}) as SourceControlRequest;
    if (host.registry.get(SOURCE_CONTROL)?.minimized) host.restore(SOURCE_CONTROL);
    let panel = host.dock.getPanel(SOURCE_CONTROL);
    const params = { ...(detail.contextId ? { contextId: detail.contextId } : {}), ...(detail.root ? { root: detail.root } : {}) };
    if (!panel) { panel = host.dock.addPanel({ id: SOURCE_CONTROL, title: 'Source Control', component: 'source-control', renderer: 'always', params, position: { referencePanel: host.reference() } }); host.remember?.(panel); }
    else if (detail.root) panel.api.updateParameters({ ...panel.api.getParameters(), ...params });
    panel.api.setActive(); host.syncEmpty();
  };
  const openDiff = (event: Event) => {
    const detail = (event as CustomEvent<GitDiffRequest>).detail;
    if (!detail?.path || !detail.contextId) return;
    const view = detail.view === 'staged' ? 'staged' : 'working', id = `git-diff:${detail.contextId}:${view}:${detail.path}`;
    let panel = host.dock.getPanel(id);
    if (!panel) {
      const name = detail.path.split('/').pop() || detail.path;
      panel = host.dock.addPanel({ id, title: `${name} (${view === 'staged' ? 'staged' : 'changes'})`, component: 'git-diff', params: { contextId: detail.contextId, path: detail.path, view }, position: { referencePanel: host.reference() } });
      host.remember?.(panel);
    }
    panel.api.setActive(); host.syncEmpty();
  };
  window.addEventListener('atlas:open-source-control', openSourceControl);
  window.addEventListener('atlas:open-git-diff', openDiff);
  return () => { window.removeEventListener('atlas:open-source-control', openSourceControl); window.removeEventListener('atlas:open-git-diff', openDiff); };
}

/** Command palette entries for git. */
export function registerGitCommands(registry: AtlasCommandRegistry): () => void {
  const open = (detail: SourceControlRequest = {}) => { window.dispatchEvent(new CustomEvent('atlas:open-source-control', { detail })); };
  const removers = [
    registry.register({ id: 'git.open', label: 'Source Control: Open', keywords: ['git', 'scm', 'commit', 'changes', 'diff'], shortcut: 'Ctrl+Shift+G', run: () => open() }),
    registry.register({ id: 'git.refresh', label: 'Source Control: Refresh status', keywords: ['git', 'status'], run: () => { window.dispatchEvent(new CustomEvent('atlas:git-changed', { detail: {} })); } }),
  ];
  const keyboard = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'g') { event.preventDefault(); open(); } };
  window.addEventListener('keydown', keyboard);
  return () => { for (const remove of removers) remove(); window.removeEventListener('keydown', keyboard); };
}
