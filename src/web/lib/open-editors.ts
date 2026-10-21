// Live editors for files that are open in the workbench. Replace-across-files
// edits a dirty editor's buffer in place (undoable with CodeMirror undo)
// instead of writing that file, and refreshes clean editors after a write.

export interface EditorChange { from: number; to: number; insert: string }
export interface OpenEditor {
  contextId: string;
  path: string;
  panelId?: string;
  bufferId?: string;
  dirty(): boolean;
  content(): string;
  fingerprint(): string;
  /** Applies changes as one undoable user transaction; the editor becomes dirty. */
  applyChanges(changes: EditorChange[]): void;
  /** Replaces the content with what is now on disk; the editor stays clean. */
  syncSaved(content: string, fingerprint: string): void;
}

const editors = new Set<OpenEditor>();
const key = (contextId: string, path: string) => `${contextId}\u0000${path}`;

export const openEditors = {
  register(editor: OpenEditor) { editors.add(editor); return () => { editors.delete(editor); }; },
  find(contextId: string, path: string): OpenEditor[] { return [...editors].filter(editor => key(editor.contextId, editor.path) === key(contextId, path)); },
  all(): OpenEditor[] { return [...editors]; },
};
