<script lang="ts">
  import { onMount, mount, unmount } from 'svelte';
  import { createDockview, type GroupPanelPartInitParameters, type IContentRenderer, type ITabRenderer, type TabPartInitParameters } from 'dockview';
  import { writable } from 'svelte/store';
  import PanelHost from './PanelHost.svelte';
  import type { WorkbenchState } from '../lib/workbench-state.js';

  export let state: WorkbenchState;
  let centerHost: HTMLDivElement;
  let bottomHost: HTMLDivElement;
  let bottomVisible = false;
  const dirtyPanels = new Set<string>();

  class Renderer implements IContentRenderer {
    element = document.createElement('div');
    component: any;
    params = writable<Record<string, unknown>>({});
    readonly kind: string;
    constructor(kind: string) { this.kind = kind; this.element.className = 'dock-panel-host'; }
    init(parameters: GroupPanelPartInitParameters) {
      this.params.set(parameters.params ?? {});
      this.component = mount(PanelHost, { target: this.element, props: { kind: this.kind, paramsStore: this.params, state } });
    }
    update(event: { params: Record<string, unknown> }) { this.params.update(value => ({ ...value, ...event.params })); }
    dispose() { if (this.component) void unmount(this.component); }
  }

  class GuardedFileTab implements ITabRenderer {
    element = document.createElement('div');
    private title = document.createElement('span');
    private close = document.createElement('button');
    private titleSubscription?: { dispose(): void };
    private panelId = '';
    constructor() {
      this.element.className = 'atlas-file-tab';
      this.title.className = 'atlas-file-tab-title';
      this.close.className = 'atlas-file-tab-close';
      this.close.type = 'button'; this.close.textContent = '×';
      this.element.append(this.title, this.close);
    }
    init(parameters: TabPartInitParameters) {
      this.panelId = parameters.api.id;
      this.element.dataset.panelId = this.panelId;
      const update = (title: string) => { this.title.textContent = title; this.close.setAttribute('aria-label', `Close ${title}`); };
      update(parameters.title);
      this.titleSubscription = parameters.api.onDidTitleChange(event => update(event.title));
      this.close.onclick = event => { event.stopPropagation(); if (!dirtyPanels.has(this.panelId) || window.confirm('Close this file and discard unsaved changes?')) { dirtyPanels.delete(this.panelId); parameters.api.close(); } };
    }
    dispose() { this.titleSubscription?.dispose(); }
  }

  onMount(() => {
    const createComponent = ({ name }: { name: string }) => new Renderer(name);
    const createTabComponent = ({ name }: { name: string }) => name === 'guarded-file' ? new GuardedFileTab() : undefined;
    const tabMenu = ({ panel }: any): any[] => dirtyPanels.has(panel.id) ? [] : dirtyPanels.size ? ['close', 'separator', 'maximize'] : ['close', 'closeOthers', 'closeAll', 'separator', 'maximize'];
    const center = createDockview(centerHost, { createComponent, createTabComponent, getTabContextMenuItems: tabMenu });
    const bottom = createDockview(bottomHost, { createComponent });
    const saved = localStorage.getItem('atlas.workbench.v1');
    let restored = false;
    if (saved) try { const value = JSON.parse(saved); if (value && value.version === 1 && value.central && value.bottom) { center.fromJSON(value.central); bottom.fromJSON(value.bottom); restored = true; } } catch { center.clear(); bottom.clear(); }
    if (!restored) {
      center.clear(); bottom.clear();
      const graph = center.addPanel({ id: 'atlas.graph', title: 'Atlas graph', component: 'graph' });
      center.addPanel({ id: 'atlas.metrics', title: 'Metrics & coverage', component: 'metrics' });
      center.addPanel({ id: 'atlas.inspector', title: 'Inspector', component: 'details', position: { referencePanel: 'atlas.graph', direction: 'right' } });
      graph.api.setActive();
      bottom.addPanel({ id: 'atlas.terminal', title: 'Terminal', component: 'terminal', renderer: 'always' });
      bottom.addPanel({ id: 'atlas.activity', title: 'Activity', component: 'output' });
    }
    const persist = () => { const layout = { version: 1, central: center.toJSON(), bottom: bottom.toJSON() }; state.setLayout(layout); localStorage.setItem('atlas.workbench.v1', JSON.stringify(layout)); };
    const a = center.onDidLayoutChange(persist), b = bottom.onDidLayoutChange(persist), removed = center.onDidRemovePanel(panel => dirtyPanels.delete(panel.id));
    let previewId: string | undefined, previewResource = '';
    const filePanels = new Map<string, string>();
    for (const panel of center.panels) { const params = panel.api.getParameters<{ contextId?: string; path?: string }>(); if (panel.api.component === 'file' && params.contextId && params.path) filePanels.set(`${params.contextId}:${params.path}`, panel.id); }
    const openFile = (event: Event) => {
      const resource = (event as CustomEvent<{ contextId: string; path: string; pinned?: boolean; line?: number }>).detail;
      const key = `${resource.contextId}:${resource.path}`, mapped = filePanels.get(key);
      if (mapped) { const panel = center.getPanel(mapped); if (panel) { if (resource.pinned && mapped === previewId) { previewId = undefined; previewResource = ''; panel.api.setTitle(resource.path.split('/').at(-1) ?? resource.path); } panel.api.setActive(); window.dispatchEvent(new CustomEvent('atlas:file-reveal', { detail: { panelId: mapped, line: resource.line } })); return; } filePanels.delete(key); }
      if (!resource.pinned && previewId) { const current = center.getPanel(previewId); if (current) { filePanels.delete(previewResource); current.api.updateParameters({ ...resource, panelId: previewId }); previewResource = key; filePanels.set(key, previewId); current.api.setTitle(`${resource.path.split('/').at(-1) ?? resource.path} · preview`); current.api.setActive(); return; } previewId = undefined; previewResource = ''; }
      const id = resource.pinned ? `file:${key}` : `file:preview:${crypto.randomUUID()}`;
      if (!resource.pinned) { previewId = id; previewResource = key; }
      filePanels.set(key, id);
      center.addPanel({ id, title: `${resource.path.split('/').at(-1) ?? resource.path}${resource.pinned ? '' : ' · preview'}`, component: 'file', tabComponent: 'guarded-file', params: { ...resource, panelId: id }, renderer: 'always' });
    };
    const dirtyFile = (event: Event) => {
      const detail = (event as CustomEvent<{ panelId?: string; dirty: boolean }>).detail, id = detail.panelId; if (!id) return;
      const panel = center.getPanel(id);
      if (detail.dirty) { dirtyPanels.add(id); if (id === previewId) { previewId = undefined; previewResource = ''; } if (panel && !panel.title?.endsWith(' ●')) panel.api.setTitle((panel.title ?? 'File').replace(' · preview', '') + ' ●'); }
      else { dirtyPanels.delete(id); if (panel) panel.api.setTitle((panel.title ?? 'File').replace(/ ●$/, '')); }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyPanels.size) event.preventDefault(); };
    const guardMiddleClick = (event: MouseEvent) => { const id = (event.target as HTMLElement).closest<HTMLElement>('[data-panel-id]')?.dataset.panelId; if (event.button === 1 && id && dirtyPanels.has(id)) { event.preventDefault(); event.stopImmediatePropagation(); } };
    const openTerminal = () => { bottomVisible = true; const panel = bottom.getPanel('atlas.terminal'); panel?.api.setActive(); };
    window.addEventListener('atlas:open-file', openFile); window.addEventListener('atlas:file-dirty', dirtyFile); window.addEventListener('atlas:open-terminal', openTerminal); window.addEventListener('beforeunload', beforeUnload); centerHost.addEventListener('auxclick', guardMiddleClick, true);
    return () => { window.removeEventListener('atlas:open-file', openFile); window.removeEventListener('atlas:file-dirty', dirtyFile); window.removeEventListener('atlas:open-terminal', openTerminal); window.removeEventListener('beforeunload', beforeUnload); centerHost.removeEventListener('auxclick', guardMiddleClick, true); a.dispose(); b.dispose(); removed.dispose(); center.dispose(); bottom.dispose(); };
  });
</script>

<main class="workbench" class:terminal-open={bottomVisible}><div class="center-dock" bind:this={centerHost}></div><div class:bottom-collapsed={!bottomVisible} class="bottom-dock" bind:this={bottomHost}></div></main>
