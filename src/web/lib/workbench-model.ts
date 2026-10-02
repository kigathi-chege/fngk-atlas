export interface FileResource { contextId: string; path: string }
export interface PanelDescriptor { id: string; kind: string; title: string; resource?: FileResource; preview: boolean; dirty: boolean; params?: Record<string, unknown> }
const resourceKey = (resource: FileResource) => `${resource.contextId}:${resource.path}`;
const stableId = (value: string) => { let hash = 2166136261; for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); };

export class WorkbenchModel {
  #panels: PanelDescriptor[] = [];
  panels(): readonly PanelDescriptor[] { return this.#panels; }
  panel(id: string): PanelDescriptor | undefined { return this.#panels.find(value => value.id === id); }
  openFile(resource: FileResource, pinned = false): PanelDescriptor {
    const existing = this.#panels.find(value => value.kind === 'file' && value.resource && resourceKey(value.resource) === resourceKey(resource)); if (existing) { if (pinned) existing.preview = false; return existing; }
    if (!pinned) { const preview = this.#panels.find(value => value.preview && !value.dirty); if (preview) { preview.kind = 'file'; preview.title = resource.path.split('/').at(-1) || resource.path; preview.resource = resource; return preview; } }
    const descriptor: PanelDescriptor = { id: pinned ? `file:${stableId(resourceKey(resource))}` : 'file:preview', kind: 'file', title: resource.path.split('/').at(-1) || resource.path, resource, preview: !pinned, dirty: false };
    this.#panels.push(descriptor); return descriptor;
  }
  open(descriptor: Omit<PanelDescriptor, 'dirty'> & { dirty?: boolean }): PanelDescriptor { const existing = this.panel(descriptor.id); if (existing) return existing; const value = { ...descriptor, dirty: descriptor.dirty ?? false }; this.#panels.push(value); return value; }
  pin(id: string): void { const panel = this.panel(id); if (panel) panel.preview = false; }
  markDirty(id: string, dirty: boolean): void { const panel = this.panel(id); if (panel) { panel.dirty = dirty; if (dirty) { panel.preview = false; if (panel.id === 'file:preview' && panel.resource) panel.id = `file:${stableId(resourceKey(panel.resource))}`; } } }
  close(id: string): void { this.#panels = this.#panels.filter(value => value.id !== id); }
  serialize(layout: unknown) { return { version: 1, layout, panels: this.#panels.map(({ id, kind, title, resource, preview, dirty, params }) => ({ id, kind, title, resource, preview, dirty, params })) }; }
}
