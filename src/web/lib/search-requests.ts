// Opening the Search panel can race its lazy mount, so the latest request is
// kept until the panel takes it.
export interface SearchRequest { replace?: boolean; query?: string; root?: string; contextId?: string; /** Start the search right away. */ run?: boolean }
let pending: SearchRequest | undefined;

export function requestSearch(request: SearchRequest = {}) {
  pending = request;
  window.dispatchEvent(new Event('atlas:open-search'));
  window.dispatchEvent(new CustomEvent('atlas:search-request', { detail: request }));
}
export function takeSearchRequest(): SearchRequest | undefined { const value = pending; pending = undefined; return value; }

/** The smallest single change turning `from` into `to`, so cursors survive. */
export function minimalChange(from: string, to: string) {
  let start = 0; while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let end = 0; while (end < from.length - start && end < to.length - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}
