import { gitGet, type GitEntry, type GitStatusResult } from './git-api.js';

/**
 * A cached map of git status per repository, for decorations (tree letters,
 * colours) and anything else that only needs to know "what changed here".
 * Repositories are discovered lazily: the shallowest folder a view shows is
 * asked once, and folders holding a `.git` entry register themselves.
 * Status refreshes after a save, after any git operation, and when the window
 * regains focus.
 */
export interface RepositoryStatus { contextId: string; root: string; result: GitStatusResult; files: Map<string, GitEntry>; folders: Map<string, string>; loadedAt: number }
export interface Decoration { letter: string; tone: string; folder: boolean; title: string }

const key = (contextId: string, path: string) => `${contextId}\u0000${path}`;
const parentOf = (value: string) => value === '/' ? '/' : value.slice(0, value.lastIndexOf('/')) || '/';
const inside = (root: string, value: string) => root === '/' || value === root || value.startsWith(`${root}/`);
/** Which change matters most when a folder holds several. */
const weight: Record<string, number> = { '!': 5, D: 4, M: 3, R: 3, C: 3, A: 2, U: 1 };

export function toneFor(letter: string): string {
  return letter === '!' ? 'conflict' : letter === 'D' ? 'deleted' : letter === 'A' ? 'added' : letter === 'U' ? 'untracked' : letter === 'R' || letter === 'C' ? 'renamed' : 'modified';
}
const describe: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', U: 'Untracked', '!': 'Conflict' };

export class GitStatusStore {
  #repositories = new Map<string, RepositoryStatus>();
  #discovered = new Map<string, Promise<string | null>>();
  #loading = new Map<string, Promise<RepositoryStatus | undefined>>();
  #listeners = new Set<() => void>();
  #observedRoots = new Map<string, string>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #lastFocus = 0;
  #installed = false;

  subscribe(listener: () => void) { this.#install(); this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #publish() { for (const listener of this.#listeners) listener(); }

  repositories(contextId?: string): RepositoryStatus[] { return [...this.#repositories.values()].filter(value => !contextId || value.contextId === contextId); }

  /** The repository whose work tree holds `path`, preferring the deepest. */
  repositoryFor(contextId: string, path: string): RepositoryStatus | undefined {
    let best: RepositoryStatus | undefined;
    for (const value of this.#repositories.values()) if (value.contextId === contextId && inside(value.root, path) && (!best || value.root.length > best.root.length)) best = value;
    return best;
  }

  decoration(contextId: string, path: string): Decoration | undefined {
    const repository = this.repositoryFor(contextId, path);
    if (!repository) return undefined;
    const entry = repository.files.get(path);
    if (entry) return { letter: entry.letter, tone: toneFor(entry.letter), folder: false, title: `${describe[entry.letter] ?? 'Changed'}${entry.groups.includes('staged') && entry.groups.includes('changes') ? ' (partly staged)' : entry.groups.includes('staged') ? ' (staged)' : ''}` };
    const folder = repository.folders.get(path);
    return folder ? { letter: '•', tone: toneFor(folder), folder: true, title: 'Contains changes' } : undefined;
  }

  /**
   * A view shows `folder`. The first folder seen per context is asked which
   * repository holds it; deeper folders only matter if they hold `.git`.
   */
  observe(contextId: string, folder: string) {
    const current = this.#observedRoots.get(contextId);
    if (current !== undefined && inside(current, folder)) return;
    if (current === undefined || inside(folder, current)) this.#observedRoots.set(contextId, folder);
    void this.discover(contextId, folder);
  }

  /** A folder that holds a `.git` entry is a repository root. */
  noteRepository(contextId: string, root: string) {
    if (this.#repositories.has(key(contextId, root)) || this.#loading.has(key(contextId, root))) return;
    void this.refresh(contextId, root);
  }

  discover(contextId: string, folder: string): Promise<string | null> {
    const id = key(contextId, folder);
    let pending = this.#discovered.get(id);
    if (!pending) {
      pending = gitGet<{ repository: { root: string; bare: boolean } | null }>('repository', { contextId, root: folder })
        .then(value => value.repository && !value.repository.bare ? value.repository.root : null)
        .catch(() => { this.#discovered.delete(id); return null; });
      this.#discovered.set(id, pending);
      void pending.then(root => { if (root) this.noteRepository(contextId, root); });
    }
    return pending;
  }

  async refresh(contextId: string, root: string): Promise<RepositoryStatus | undefined> {
    const id = key(contextId, root), existing = this.#loading.get(id);
    if (existing) return await existing;
    const pending = (async () => {
      try {
        const result = await gitGet<GitStatusResult>('status', { contextId, root });
        if (!result.repository) { this.#repositories.delete(id); return undefined; }
        const files = new Map<string, GitEntry>(), folders = new Map<string, string>();
        for (const entry of result.entries ?? []) {
          files.set(entry.logicalPath, entry);
          for (let folder = parentOf(entry.logicalPath); inside(result.repository.root, folder); folder = parentOf(folder)) {
            const previous = folders.get(folder);
            if (!previous || (weight[entry.letter] ?? 0) > (weight[previous] ?? 0)) folders.set(folder, entry.letter);
            if (folder === result.repository.root || folder === '/') break;
          }
        }
        const value = { contextId, root: result.repository.root, result, files, folders, loadedAt: Date.now() };
        this.#repositories.set(key(contextId, value.root), value);
        return value;
      } catch { return this.#repositories.get(id); }
      finally { this.#loading.delete(id); this.#publish(); }
    })();
    this.#loading.set(id, pending);
    return await pending;
  }

  /** Coalesce bursts (several saves, a stage then a commit) into one refresh. */
  schedule(contextId: string, root: string, delayMs = 250) {
    const id = key(contextId, root);
    clearTimeout(this.#timers.get(id));
    this.#timers.set(id, setTimeout(() => { this.#timers.delete(id); void this.refresh(contextId, root); }, delayMs));
  }

  refreshAll() { for (const value of this.#repositories.values()) this.schedule(value.contextId, value.root, 50); }

  #install() {
    if (this.#installed || typeof window === 'undefined') return;
    this.#installed = true;
    window.addEventListener('atlas:buffer-saved', event => {
      const detail = (event as CustomEvent<{ contextId?: string; path?: string }>).detail;
      if (!detail?.contextId || !detail.path) return;
      const repository = this.repositoryFor(detail.contextId, detail.path);
      if (repository) this.schedule(repository.contextId, repository.root);
    });
    window.addEventListener('atlas:git-changed', event => {
      const detail = (event as CustomEvent<{ contextId?: string; root?: string }>).detail;
      if (detail?.contextId && detail.root) this.schedule(detail.contextId, detail.root, 0);
      else this.refreshAll();
    });
    window.addEventListener('focus', () => { if (Date.now() - this.#lastFocus < 3_000) return; this.#lastFocus = Date.now(); this.refreshAll(); });
  }
}

export const gitStatusStore = new GitStatusStore();
