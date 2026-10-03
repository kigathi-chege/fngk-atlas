<script lang="ts">
  import { onMount } from 'svelte';
  import { DeviceSessionStore, type DeviceSessionSnapshot } from '../lib/device-session-store.js';
  import type { WorkbenchState } from '../lib/workbench-state.js';
  import './DeviceSessionsPanel.css';
  export let state: WorkbenchState;
  const sessions = new DeviceSessionStore();
  let profile = '';
  let pending: DeviceSessionSnapshot | undefined;
  let message = '';
  const describe = (item: DeviceSessionSnapshot) => `${item.scope.deviceId}${item.scope.projectId ? ` · ${item.scope.projectId}` : ''}`;
  async function refresh() { profile = state.snapshot().connection.profile ?? ''; await sessions.refresh(profile); }
  async function act(action: 'reconnect' | 'revoke' | 'cache/clear', item: DeviceSessionSnapshot) {
    if (action === 'revoke' && pending !== item) { pending = item; return; }
    pending = undefined; message = '';
    try { await sessions.act(action, item.scope); message = action === 'revoke' ? 'Session revoked.' : action === 'reconnect' ? 'Session reconnect requested.' : 'Filesystem cache cleared.'; }
    catch (error) { message = (error as Error).message; }
  }
  onMount(() => { const unsubscribe = state.subscribe(() => void refresh()); void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => { unsubscribe(); clearInterval(timer); }; });
</script>

<section class="device-sessions-panel" aria-label="Device Sessions">
  <header><div><small>CONNECTIONS</small><h2>Device Sessions</h2><p>Persistent scoped FNGK connections and their active streams.</p></div><button onclick={refresh} disabled={sessions.loading}>Refresh</button></header>
  {#if message}<p class="session-message" aria-live="polite">{message}</p>{/if}
  {#if sessions.error}<p class="session-error" role="alert">{sessions.error}</p>{/if}
  {#if !sessions.loading && !sessions.items.length}<p class="session-empty">No active sessions for this profile. Opening a device file or terminal creates one when needed.</p>{/if}
  <div class="session-list">
    {#each sessions.items as item (item.sessionId ?? `${item.scope.profile}:${item.scope.deviceId}:${item.scope.projectId ?? ''}`)}
      <article class:ready={item.state === 'ready'} class="session-card">
        <div class="session-heading"><div><strong>{describe(item)}</strong><small>{item.scope.profile} · {item.state}</small></div><span>{item.activeStreams} streams</span></div>
        <dl><div><dt>Session</dt><dd>{item.sessionId?.slice(0, 12) ?? 'connecting'}</dd></div><div><dt>Purpose</dt><dd>Atlas internal connection</dd></div><div><dt>Handshakes</dt><dd>{item.handshakeCount}</dd></div><div><dt>Cache revision</dt><dd>{item.cacheEpoch}</dd></div><div><dt>Grants</dt><dd>Managed per tool</dd></div></dl>
        {#if item.lastFailure}<p class="failure">{item.lastFailure.message}</p>{/if}
        <div class="session-actions"><button onclick={() => act('reconnect', item)}>Reconnect</button><button onclick={() => act('cache/clear', item)}>Clear cache</button><button class="danger" onclick={() => act('revoke', item)}>Revoke</button></div>
        {#if pending === item}<div class="confirm" role="alert"><span>Revoke this session and all its streams?</span><button onclick={() => pending = undefined}>Cancel</button><button class="danger" onclick={() => act('revoke', item)}>Revoke session</button></div>{/if}
      </article>
    {/each}
  </div>
</section>
