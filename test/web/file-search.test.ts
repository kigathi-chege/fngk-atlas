import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileSearchController, fileSearchStatus, fileSearchUrl, searchRootsFor, type FileSearchView } from '../../src/web/lib/file-search.js';

afterEach(() => { vi.useRealTimers(); });

describe('file search controller', () => {
  it('requests only the final query when typing quickly and never reports the superseded ones', async () => {
    vi.useFakeTimers();
    const urls: string[] = [], aborted: string[] = [], views: FileSearchView[] = [];
    const controller = new FileSearchController({
      debounceMs: 150,
      fetch: (url, signal) => new Promise((resolve, reject) => {
        urls.push(url);
        signal.addEventListener('abort', () => { aborted.push(url); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
        setTimeout(() => resolve({ matches: [{ path: `/w/${new URL(url, 'http://x').searchParams.get('query')}.ts`, type: 'file' }], truncated: false, root: '/w', elapsedMs: 12 }), 400);
      }),
      onChange: view => views.push(view),
    });
    for (const query of ['s', 'sa', 'sam', 'samp', 'sample']) { controller.search({ contextId: 'device:1', root: '/w', query }); await vi.advanceTimersByTimeAsync(40); }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('query=sample');
    expect(urls[0]).toContain('mode=name');
    expect(views.some(view => view.error)).toBe(false);
    expect(controller.view).toMatchObject({ query: 'sample', loading: false, done: true, matches: [{ path: '/w/sample.ts' }] });
  });

  it('drops an in-flight result once a newer query starts, silently', async () => {
    vi.useFakeTimers();
    const views: FileSearchView[] = [];
    let first = true;
    const controller = new FileSearchController({ debounceMs: 10, onChange: view => views.push(view), fetch: (url, signal) => new Promise((resolve, reject) => {
      const slow = first; first = false;
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Filesystem search was superseded.'), { code: 'cancelled' })));
      setTimeout(() => resolve({ matches: [{ path: slow ? '/stale' : '/fresh', type: 'file' }], root: '/' }), slow ? 500 : 20);
    }) });
    controller.search({ contextId: 'local', root: '/', query: 'old' });
    await vi.advanceTimersByTimeAsync(50);
    controller.search({ contextId: 'local', root: '/', query: 'new' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(views.flatMap(view => view.matches.map(match => match.path))).not.toContain('/stale');
    expect(views.some(view => view.error)).toBe(false);
    expect(controller.view.matches).toEqual([{ path: '/fresh', type: 'file' }]);
  });

  it('reports a real failure once', async () => {
    vi.useFakeTimers();
    const controller = new FileSearchController({ debounceMs: 0, onChange: () => {}, fetch: async () => { throw new Error('Device offline'); } });
    controller.search({ contextId: 'local', root: '/', query: 'x' });
    await vi.advanceTimersByTimeAsync(10);
    expect(controller.view).toMatchObject({ error: 'Device offline', done: true });
  });
});

describe('file search wording and roots', () => {
  const base = { query: 'q', root: '/srv', loading: false, error: '', done: true, matches: [], truncated: false } as const;
  it('says where nothing was found, and when it stopped early', () => {
    expect(fileSearchStatus(base)).toBe('No matches in /srv');
    expect(fileSearchStatus({ ...base, truncated: true, reason: 'time', elapsedMs: 3_050 })).toBe('Stopped after 3s — narrow the folder (no matches yet in /srv)');
    expect(fileSearchStatus({ ...base, matches: [{ path: '/srv/q', type: 'file' }], truncated: true, reason: 'limit' })).toBe('Showing the first 1 matches in /srv — refine the search');
    expect(fileSearchStatus({ ...base, loading: true })).toBe('');
    expect(fileSearchUrl({ contextId: 'device:a', root: '~', query: 'a b' })).toBe('/api/files/search?contextId=device%3Aa&path=~&query=a%20b&mode=name&limit=200');
  });
  it('uses workspace roots for the context, else home', () => {
    const storage = { getItem: () => JSON.stringify([{ contextId: 'device:a', path: '/srv/app', kind: 'workspace' }, { contextId: 'device:a', path: '/srv', kind: 'pinned' }, { contextId: 'local', path: '/x', kind: 'workspace' }]) };
    expect(searchRootsFor('device:a', storage)).toEqual(['/srv/app']);
    expect(searchRootsFor('device:b', storage)).toEqual(['~']);
    expect(searchRootsFor('device:a', { getItem: () => '{bad' })).toEqual(['~']);
  });
});
