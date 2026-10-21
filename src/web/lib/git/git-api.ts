import { api, ApiError, atlasRequestHeaders } from '../api.js';

export type GitGroup = 'staged' | 'changes' | 'untracked' | 'conflicts';
export interface GitEntry { kind: 'ordinary' | 'renamed' | 'unmerged' | 'untracked'; path: string; origPath?: string; index: string; worktree: string; logicalPath: string; groups: GitGroup[]; letter: string }
export interface GitBranchState { oid?: string; head?: string; detached: boolean; unborn: boolean; upstream?: string; ahead: number; behind: number }
export interface GitStatusResult { repository: { root: string } | null; branch?: GitBranchState; entries?: GitEntry[] }
export interface GitCommit { hash: string; shortHash: string; parents: string[]; authorName: string; authorEmail: string; authoredAt: string; refs: string[]; subject: string; body: string }
export interface GitBranch { name: string; ref: string; remote: boolean; current: boolean; upstream?: string; ahead: number; behind: number; gone: boolean; subject: string }
export interface GitSyncEvent { type: 'start' | 'output' | 'done'; text?: string; ok?: boolean; exitCode?: number | null; message?: string; operation?: string; elapsedMs?: number; error?: string }

const query = (values: Record<string, string | number | boolean | undefined>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();

export const gitGet = <T>(endpoint: string, values: Record<string, string | number | boolean | undefined>, init?: RequestInit) => api<T>(`/api/git/${endpoint}?${query(values)}`, init);
export const gitPost = <T>(endpoint: string, body: Record<string, unknown>) => api<T>(`/api/git/${endpoint}`, { method: 'POST', body: JSON.stringify(body) });

/** True when the server refused a destructive change until it is confirmed. */
export const needsConfirmation = (error: unknown) => error instanceof ApiError && error.code === 'confirmation_required';

/** Fetch, pull, push or clone: reads the NDJSON progress stream as it arrives. */
export async function gitStream(endpoint: string, body: Record<string, unknown>, onEvent: (event: GitSyncEvent) => void, signal?: AbortSignal): Promise<GitSyncEvent> {
  const response = await fetch(`/api/git/${endpoint}`, { method: 'POST', signal, body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/x-ndjson, application/json', ...atlasRequestHeaders() } });
  if (!response.ok || !response.headers.get('content-type')?.includes('ndjson')) {
    const text = await response.text(); let value: any = {};
    try { value = text ? JSON.parse(text) : {}; } catch { value = { message: text }; }
    throw new ApiError(response.status, value.error ?? 'request_failed', value.message ?? `Request failed (${response.status}).`, value);
  }
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let buffered = '', last: GitSyncEvent = { type: 'done', ok: false, message: 'The operation ended without a result.' };
  for (;;) {
    const { value, done } = await reader.read();
    buffered += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffered.split('\n'); buffered = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) { const event = JSON.parse(line) as GitSyncEvent; if (event.type === 'done') last = event; onEvent(event); }
    if (done) break;
  }
  return last;
}

/** Announce that git changed a repository, so trees, gutters and panels refresh. */
export function announceGitChange(contextId: string, root?: string) {
  window.dispatchEvent(new CustomEvent('atlas:git-changed', { detail: { contextId, root } }));
}
