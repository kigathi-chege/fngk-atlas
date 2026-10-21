import { RangeSet, StateEffect, Text, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, ViewPlugin, gutter, type ViewUpdate } from '@codemirror/view';
import { Chunk } from '@codemirror/merge';
import { gitGet } from './git-api.js';
import { gitStatusStore } from './git-status-store.js';
import './git.css';

export type LineChange = 'added' | 'modified' | 'deleted';

class ChangeMarker extends GutterMarker {
  constructor(readonly change: LineChange) { super(); }
  eq(other: ChangeMarker) { return other.change === this.change; }
  toDOM() { const element = document.createElement('span'); element.className = `cm-git-marker ${this.change}`; element.title = this.change === 'added' ? 'Added since HEAD' : this.change === 'modified' ? 'Changed since HEAD' : 'Lines removed here since HEAD'; return element; }
}
const markers = { added: new ChangeMarker('added'), modified: new ChangeMarker('modified'), deleted: new ChangeMarker('deleted') };

/**
 * Lines that differ from `base`, as 1-based line numbers of `doc`. Pure so it
 * can be tested without a browser.
 */
export function lineChanges(base: Text, doc: Text): Array<{ line: number; change: LineChange }> {
  const result = new Map<number, LineChange>();
  // A file absent from HEAD: every line is new (an empty base still has one empty line).
  if (base.length === 0) return doc.length === 0 ? [] : Array.from({ length: doc.lines }, (_, index) => ({ line: index + 1, change: 'added' as const }));
  for (const chunk of Chunk.build(base, doc, { scanLimit: 500, timeout: 50 })) {
    if (chunk.fromB === chunk.toB) {
      // Deleted lines: mark the line that now follows the gap (or the last line).
      const position = Math.min(chunk.fromB, doc.length);
      const line = doc.lineAt(position).number;
      if (!result.has(line)) result.set(line, 'deleted');
      continue;
    }
    const change: LineChange = chunk.fromA === chunk.toA ? 'added' : 'modified';
    const first = doc.lineAt(chunk.fromB).number, last = doc.lineAt(Math.max(chunk.fromB, chunk.endB)).number;
    for (let line = first; line <= last; line += 1) result.set(line, change);
  }
  return [...result].sort(([left], [right]) => left - right).map(([line, change]) => ({ line, change }));
}

const recomputed = StateEffect.define<null>();

/**
 * Gutter markers for added, modified and deleted lines versus HEAD. HEAD's
 * content is fetched once (and again after git operations); the comparison
 * runs client-side, debounced while typing.
 */
export function gitGutter(contextId: string, file: string, options: { debounceMs?: number } = {}): Extension {
  if (!file || !file.startsWith('/')) return [];
  const debounceMs = options.debounceMs ?? 250;
  const plugin = ViewPlugin.fromClass(class {
    base: Text | null = null;
    set = RangeSet.empty as RangeSet<GutterMarker>;
    timer: ReturnType<typeof setTimeout> | undefined;
    generation = 0;
    destroyed = false;
    listener = (event: Event) => { const detail = (event as CustomEvent<{ contextId?: string }>).detail; if (!detail?.contextId || detail.contextId === contextId) void this.load(); };
    focus = () => { if (Date.now() - this.focusedAt > 10_000) { this.focusedAt = Date.now(); void this.load(); } };
    focusedAt = Date.now();
    constructor(readonly view: EditorView) {
      window.addEventListener('atlas:git-changed', this.listener);
      window.addEventListener('focus', this.focus);
      void this.load();
    }
    async load() {
      const generation = ++this.generation;
      try {
        const value = await gitGet<{ exists: boolean; binary: boolean; tooLarge: boolean; text: string }>('show', { contextId, file, ref: 'HEAD' });
        if (this.destroyed || generation !== this.generation) return;
        if (value.binary || value.tooLarge) this.base = null;
        else if (value.exists) this.base = Text.of(value.text.split(/\r?\n/));
        else {
          // Not in HEAD: everything is new if git tracks or offers it, otherwise (ignored) nothing.
          const entry = gitStatusStore.repositoryFor(contextId, file)?.files.get(file);
          this.base = entry ? Text.empty : null;
        }
      } catch { if (!this.destroyed && generation === this.generation) this.base = null; }
      this.compute();
    }
    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      // Keep markers roughly in place while typing, then recompute.
      this.set = this.set.map(update.changes);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.compute(), debounceMs);
    }
    compute() {
      if (this.destroyed) return;
      const doc = this.view.state.doc;
      this.set = this.base ? RangeSet.of(lineChanges(this.base, doc).map(({ line, change }) => markers[change].range(doc.line(line).from))) : RangeSet.empty;
      this.view.dispatch({ effects: recomputed.of(null) });
    }
    destroy() { this.destroyed = true; clearTimeout(this.timer); window.removeEventListener('atlas:git-changed', this.listener); window.removeEventListener('focus', this.focus); }
  });
  return [
    plugin,
    gutter({ class: 'cm-git-gutter', markers: view => view.plugin(plugin)?.set ?? RangeSet.empty, initialSpacer: () => markers.added }),
  ];
}
