/**
 * Debounced filesystem name search for the tree filter and the search bar.
 * Only the newest query is ever shown: a superseded request is aborted and
 * dropped silently, with no event, toast or error.
 */
export type FileSearchReason = 'limit' | 'time' | 'entries' | 'stalled';
export interface FileSearchMatch { path: string; type: 'file' | 'directory'; line?: number; preview?: string }
export interface FileSearchResponse { matches: FileSearchMatch[]; truncated?: boolean; reason?: FileSearchReason | null; examined?: number | null; elapsedMs?: number; root?: string; route?: unknown }
export interface FileSearchRequest { contextId: string; root: string; query: string; mode?: 'name' | 'content' | 'all'; limit?: number }
export interface FileSearchView { query: string; root: string; contextId: string; loading: boolean; matches: FileSearchMatch[]; truncated: boolean; reason?: FileSearchReason; elapsedMs?: number; error: string; done: boolean; route?: unknown }

export const fileSearchUrl = (request: FileSearchRequest) => `/api/files/search?contextId=${encodeURIComponent(request.contextId)}&path=${encodeURIComponent(request.root)}&query=${encodeURIComponent(request.query)}&mode=${request.mode ?? 'name'}&limit=${request.limit ?? 200}`;

const isAbort = (error: unknown) => { const value = error as { name?: string; code?: string }; return value?.name === 'AbortError' || value?.code === 'cancelled'; };
const empty = (query = '', root = '/', contextId = 'local'): FileSearchView => ({ query, root, contextId, loading: false, matches: [], truncated: false, error: '', done: false });

/** One line describing an empty or partial result; empty string when there is nothing to say. */
export function fileSearchStatus(view: Pick<FileSearchView, 'query' | 'root' | 'loading' | 'matches' | 'truncated' | 'reason' | 'elapsedMs' | 'error' | 'done'>): string {
  if (!view.query.trim() || view.loading || view.error || !view.done) return '';
  const seconds = Math.max(1, Math.round((view.elapsedMs ?? 0) / 1000));
  if (view.truncated && (view.reason === 'time' || view.reason === 'stalled')) return `${view.reason === 'stalled' ? 'A folder stopped responding' : `Stopped after ${seconds}s`} — narrow the folder${view.matches.length ? `. Showing ${view.matches.length} found so far in ${view.root}` : ` (no matches yet in ${view.root})`}`;
  if (view.truncated) return `Showing the first ${view.matches.length} matches in ${view.root} — refine the search`;
  return view.matches.length ? '' : `No matches in ${view.root}`;
}

export class FileSearchController {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #controller: AbortController | undefined;
  #generation = 0;
  #view = empty();
  constructor(private readonly options: { fetch: (url: string, signal: AbortSignal) => Promise<FileSearchResponse>; onChange: (view: FileSearchView) => void; debounceMs?: number; mode?: 'name' | 'content' | 'all'; limit?: number }) {}

  get view(): FileSearchView { return this.#view; }

  /** Schedules a search for exactly this query; earlier ones are dropped. */
  search(request: Omit<FileSearchRequest, 'mode' | 'limit'>) {
    clearTimeout(this.#timer); this.#controller?.abort(); this.#controller = undefined;
    const generation = ++this.#generation;
    if (!request.query.trim()) { this.#publish(empty('', request.root, request.contextId)); return; }
    this.#publish({ ...empty(request.query, request.root, request.contextId), loading: true, matches: this.#view.query && this.#view.contextId === request.contextId ? this.#view.matches : [] });
    this.#timer = setTimeout(async () => {
      const controller = new AbortController(); this.#controller = controller;
      try {
        const value = await this.options.fetch(fileSearchUrl({ ...request, mode: this.options.mode ?? 'name', limit: this.options.limit }), controller.signal);
        if (generation !== this.#generation) return;
        this.#publish({ ...empty(request.query, value.root ?? request.root, request.contextId), matches: value.matches ?? [], truncated: value.truncated === true, ...(value.reason ? { reason: value.reason } : {}), elapsedMs: value.elapsedMs, done: true, route: value.route });
      } catch (error) {
        if (generation !== this.#generation || isAbort(error)) return;
        this.#publish({ ...empty(request.query, request.root, request.contextId), error: (error as Error).message ?? String(error), done: true });
      } finally { if (this.#controller === controller) this.#controller = undefined; }
    }, this.options.debounceMs ?? 150);
  }

  cancel() { clearTimeout(this.#timer); this.#controller?.abort(); this.#controller = undefined; this.#generation++; this.#publish(empty('', this.#view.root, this.#view.contextId)); }

  #publish(view: FileSearchView) { this.#view = view; this.options.onChange(view); }
}

/** Where the search bar looks for names: the context's workspace roots, else home. */
export function searchRootsFor(contextId: string, storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): string[] {
  try {
    const roots = JSON.parse(storage?.getItem('atlas.workspace-roots.v1') ?? '[]') as Array<{ contextId?: string; path?: string; kind?: string }>;
    const workspace = roots.filter(value => value.contextId === contextId && value.kind === 'workspace' && typeof value.path === 'string' && value.path.startsWith('/')).map(value => value.path!);
    const unique = [...new Set(workspace)].slice(0, 3);
    if (unique.length) return unique;
  } catch {}
  return ['~'];
}
