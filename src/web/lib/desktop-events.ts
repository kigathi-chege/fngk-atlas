import { api } from './api.js';

/**
 * Desktop host events reach the page through the loopback server, not Tauri IPC.
 *
 * When Atlas is opened with a `fngk-atlas://` URL, the host focuses the window
 * and POSTs the URL to /api/desktop/deep-link. This poller turns each new one
 * into a window event:
 *
 *   window.addEventListener('atlas:deep-link', event => event.detail.url)
 *
 * Only runs inside the desktop app (where the launch capability is injected).
 */
export interface DeepLinkDetail { seq: number; url: string; receivedAt: string }
type Fetch = <T>(url: string) => Promise<T>;

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & { __ATLAS_CAPABILITY__?: unknown }).__ATLAS_CAPABILITY__ === 'string';
}

export function startDesktopEvents(options: { intervalMs?: number; fetchJson?: Fetch; target?: EventTarget } = {}): () => void {
  const fetchJson = options.fetchJson ?? (url => api(url)), target = options.target ?? window, interval = options.intervalMs ?? 1500;
  let after = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      const value = await fetchJson<{ items?: DeepLinkDetail[]; latest?: number }>(`/api/desktop/deep-links?after=${after}`);
      for (const item of value.items ?? []) { after = Math.max(after, item.seq); target.dispatchEvent(new CustomEvent<DeepLinkDetail>('atlas:deep-link', { detail: item })); }
    } catch { /* the server may be restarting; try again on the next tick */ }
    if (!stopped) timer = setTimeout(poll, interval);
  };
  void poll();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
