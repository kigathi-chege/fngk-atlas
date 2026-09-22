<script lang="ts">
  import {onMount} from 'svelte';import {api,atlasWebSocket} from '../lib/api.js';
  export let params:Record<string,unknown>={};let value:any={};let error='';let socket:WebSocket|undefined;
  async function load(){try{value=await api<any>(`/api/diagnostics/sessions/${encodeURIComponent(String(params.diagnosticId??''))}`)}catch(e){error=(e as Error).message}}
  onMount(()=>{void load();const id=String(params.diagnosticId??'');if(!id)return;socket=atlasWebSocket(`/api/diagnostics/sessions/${encodeURIComponent(id)}/events`);socket.onmessage=e=>value=JSON.parse(e.data);return()=>socket?.close()});
</script>
<section class="panel logs-panel"><header><strong>Logs</strong><span>{value.kind??'diagnostic'} · {value.status??'—'}</span></header>{#if error}<p>{error}</p>{:else}<dl><dt>Command</dt><dd><code>{value.command??((value.argv??[]).join(' ')||'—')}</code></dd>{#if value.error}<dt>Error</dt><dd class="error">{value.errorCode??'error'}: {value.error}</dd>{/if}</dl><h3>stdout</h3><pre>{value.stdout||'—'}</pre><h3>stderr</h3><pre>{value.stderr||'—'}</pre>{#if value.events?.length}<h3>events</h3><pre>{JSON.stringify(value.events,null,2)}</pre>{/if}{/if}</section>
