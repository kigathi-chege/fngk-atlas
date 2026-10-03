<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import X from '@lucide/svelte/icons/x';
  import { api, atlasWebSocket } from '../lib/api.js';
  import type { WorkbenchState } from '../lib/workbench-state.js';
  import DocumentationHelp from './DocumentationHelp.svelte';

  export let params: { target?: string; profile?: string; panelId?: string; requestId?: string } = {};
  export let state: WorkbenchState;
  let host: HTMLDivElement;
  let target = params.target ?? (state.snapshot().contextId.startsWith('device:') ? state.snapshot().contextId : '');
  let sessionId = '', streamId = '', status = 'Opening…', approval = '';
  let sessions: Array<{id:string;title?:string;status?:string}> = [];
  let terminal: Terminal, fit: FitAddon, socket: WebSocket | undefined;
  let disposed = false, retries = 0, reconnectTimer: ReturnType<typeof setTimeout>, generation = 0, request = 0, lastRequest = '';
  const send = (value: Record<string, unknown>) => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify(value));
  const encoded = (value: string) => { const bytes = new TextEncoder().encode(value); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); };

  async function refreshSessions() { if (!target.startsWith('device:')) return; try { const value=await api<any>(`/api/fngk/sessions?deviceId=${encodeURIComponent(target.slice(7))}${params.profile?`&profile=${encodeURIComponent(params.profile)}`:''}`);sessions=value.sessions??[]; } catch {} }
  function connect(force = false, newSession = false, restoreSessionId = '') {
    if (!target.trim() || disposed) return;
    if (socket && !force && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(reconnectTimer);
    const token = ++generation;
    socket?.close(1000);
    if(newSession||!restoreSessionId){sessionId = ''; streamId = '';terminal.reset();}approval = '';
    terminal.writeln(`\x1b[38;2;211;250;114mFNGK Atlas\x1b[0m  attaching to ${target}…`);
    status = retries ? 'Reconnecting…' : 'Connecting…';
    const query = new URLSearchParams({ target });
    if (params.profile) query.set('profile', params.profile);
    if (newSession) query.set('new', '1');
    if (restoreSessionId) query.set('session', restoreSessionId);
    const current = atlasWebSocket(`/api/fngk/terminals?${query}`);
    socket = current;
    current.onmessage = event => {
      if (socket !== current || token !== generation) return;
      const value = JSON.parse(event.data);
      if (value.type === 'ready') {
        sessionId = String(value.sessionId ?? '');
        streamId = String(value.streamId ?? '');
        retries = 0; status = 'Live';
        void refreshSessions();
        terminal.writeln(`\x1b[2mconnected · ${value.target ?? target} · ${value.recordingMode ?? 'leased'}\x1b[0m`);
        resize();
      } else if (value.type === 'output' || value.type === 'replay') {
        try { terminal.write(Uint8Array.from(atob(value.bodyBase64), c => c.charCodeAt(0))); } catch {}
      } else if (value.type === 'approval') {
        approval = String(value.approvalId);
        terminal.writeln(`\r\n\x1b[33mApproval required: ${value.approvalId}\x1b[0m`);
      } else if (value.type === 'collaboration') status = `Live · ${value.mode ?? value.collaborationMode ?? 'collaborative'}`;
      else if (value.type === 'error') terminal.writeln(`\r\n\x1b[31m${value.message ?? value.code}\x1b[0m`);
      else if (value.type === 'exit') { status = 'Exited'; terminal.writeln(`\r\n[exit ${value.exitCode ?? ''}]`); }
      state.appendActivity(`terminal · ${value.type}`);
    };
    current.onclose = event => {
      if (socket !== current || token !== generation || disposed) return;
      socket = undefined;
      if (event.code === 1000) { status = 'Detached'; return; }
      status = 'Interrupted';
      if (retries < 6) reconnectTimer = setTimeout(() => connect(false,false,sessionId), Math.min(8000, 500 * 2 ** retries++));
    };
    current.onerror = () => { if (socket === current) status = 'Connection error'; };
  }
  function resize() { if (!terminal || !fit) return; try { fit.fit(); send({ type: 'resize', requestId: `resize-${++request}`, cols: terminal.cols, rows: terminal.rows }); } catch {} }
  function resolveApproval(decision: 'approve' | 'deny') { send({ type: 'nested_approval_resolve', requestId: `approval-${++request}`, approvalId: approval, decision }); approval = ''; }
  function applyRequest() {
    if (!terminal || !params.requestId || params.requestId === lastRequest) return;
    lastRequest = params.requestId;
    const nextTarget = params.target ?? target;
    if (nextTarget !== target) { target = nextTarget; retries = 0; connect(true); }
  }
  $: applyRequest();
  onMount(() => {
    terminal = new Terminal({ convertEol: true, cursorBlink: true, cursorStyle: 'block', fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 12, theme: { background: '#080b0f', foreground: '#d8e2ec', cursor: '#d3fa72', cursorAccent: '#080b0f', selectionBackground: '#334154' } });
    fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host); fit.fit(); terminal.focus();
    terminal.onData(data => send({ type: 'input', requestId: `input-${++request}`, bodyBase64: encoded(data) }));
    const observer = new ResizeObserver(() => requestAnimationFrame(resize)); observer.observe(host);
    lastRequest = params.requestId ?? ''; connect(); void refreshSessions();
    return () => { disposed = true; clearTimeout(reconnectTimer); generation++; observer.disconnect(); socket?.close(1000); terminal.dispose(); };
  });
</script>

<DocumentationHelp topicId="terminals" label="Terminal documentation"/>
<section class="panel terminal-panel">
  <header><div class="terminal-target"><strong>{target || 'No remote Device selected'}</strong><small>Interactive terminal{#if sessionId} · Session {sessionId.slice(0, 8)}{/if}</small></div><span class:live={status.startsWith('Live')}>{status}</span><div>{#if approval}<button onclick={() => resolveApproval('approve')}>Approve</button><button onclick={() => resolveApproval('deny')}>Deny</button>{/if}<button title="New terminal session" aria-label="New terminal session" onclick={() => { retries = 0; connect(true, true); }}>New</button><button title="Reconnect terminal stream" aria-label="Reconnect terminal stream" onclick={() => { retries = 0; connect(true, false, sessionId); }}><RotateCw size={13}/></button><button title="Close terminal panel" onclick={() => window.dispatchEvent(new CustomEvent('atlas:close-terminal', { detail: { panelId: params.panelId } }))}><X size={13}/></button></div></header>
  <div class="terminal-body"><div class="terminal" bind:this={host}></div><aside class="terminal-rail" aria-label="Your terminal sessions"><header class="terminal-rail-heading"><span>TERMINALS</span><button class="new-session" title="New terminal session" aria-label="New terminal session" onclick={()=>{retries=0;connect(true,true)}}>+</button></header><div class="terminal-session-list">{#each sessions as item}<div class="terminal-rail-item"><button class="session-select" class:active={item.id===sessionId} title={`Open ${item.title??item.id}`} onclick={()=>{retries=0;connect(true,false,item.id)}}><span class="session-glyph">›_</span><span class="session-label"><b>{item.title??`Terminal ${item.id.slice(0,8)}`}</b><small>{item.status??'unknown'}</small></span></button></div>{/each}{#if !sessions.length}<small class="empty-copy">No user terminals.</small>{/if}</div></aside></div>
</section>
