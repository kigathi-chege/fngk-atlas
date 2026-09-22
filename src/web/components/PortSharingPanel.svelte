<script lang="ts">
  import {onMount} from 'svelte';
  import {api} from '../lib/api.js';
  import type {WorkbenchState} from '../lib/workbench-state.js';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';import Globe2 from '@lucide/svelte/icons/globe-2';import Square from '@lucide/svelte/icons/square';import ExternalLink from '@lucide/svelte/icons/external-link';
  export let params:Record<string,unknown>;export let state:WorkbenchState;
  let contextId=String(params.contextId??state.snapshot().contextId),candidates:any[]=[],published:any[]=[],status='',busy=false,confirm:any;
  $: if(params.contextId&&String(params.contextId)!==contextId){contextId=String(params.contextId);void load()}
  const active=(id:string)=>published.find(item=>item.candidateId===id&&item.status==='published');
  async function load(){busy=true;status='';try{const value=await api<any>(`/api/ports?contextId=${encodeURIComponent(contextId)}`);candidates=value.candidates??[];published=value.published??[]}catch(error){status=(error as Error).message}finally{busy=false}}
  async function scan(){busy=true;status='Inspecting listeners and verifying HTTP…';try{const value=await api<any>('/api/ports/scan',{method:'POST',body:JSON.stringify({contextId})});candidates=value.candidates??[];published=value.published??[];status=`${candidates.filter(item=>!item.stale).length} listener candidates`}catch(error){status=(error as Error).message}finally{busy=false}}
  async function publish(item:any){confirm=undefined;busy=true;try{const value=await api<any>(`/api/ports/${encodeURIComponent(item.id)}/publish`,{method:'POST',body:JSON.stringify({confirm:true})});published=[value,...published.filter(entry=>entry.id!==value.id)];candidates=[...candidates];status=`Published ${value.url}`}catch(error){const detail=(error as any).body;if(detail?.diagnosticSessionId)window.dispatchEvent(new CustomEvent('atlas:open-logs',{detail:{diagnosticId:detail.diagnosticSessionId}}));status=(error as Error).message}finally{busy=false}}
  function requestPublish(item:any){if(item.probe!=='http'){status=`Port ${item.port} is not publishable yet (${item.probe||'unverified'}). Rescan after the HTTP service is ready.`;return}confirm=item}
  async function stop(item:any){busy=true;try{const value=await api<any>(`/api/ports/${encodeURIComponent(item.candidateId)}/stop`,{method:'POST',body:JSON.stringify({confirm:true})});published=published.map(entry=>entry.id===value.id?value:entry);candidates=[...candidates];status='Public route stopped'}catch(error){status=(error as Error).message}finally{busy=false}}
  onMount(load);
</script>
<section class="panel port-sharing-panel">
  <header><div><strong>HTTP ports</strong><span>{contextId}</span></div><button title="Scan listening HTTP ports" disabled={busy} onclick={scan}><RefreshCw size={13}/></button></header>
  <div class="port-list">
    {#each candidates.filter(item=>!item.stale) as item}
      {@const route=active(item.id)}
      <article class:published={Boolean(route)}><div class="port-number">:{item.port}</div><div><strong>{item.probeTitle||item.processLabel||'HTTP listener'}</strong><span>{item.address} · {item.exposure} · {item.processLabel||'process unknown'}</span><small>{item.probe==='http'?`HTTP ${item.probeStatus??'verified'}`:item.probe}{item.cwd?` · ${item.cwd}`:''}</small></div><div class="port-actions">{#if route}<a href={route.url} target="_blank" rel="noreferrer" title="Open public URL"><ExternalLink size={13}/></a><button title="Stop public route" onclick={()=>stop(route)}><Square size={12}/></button>{:else}<button class:unverified={item.probe!=='http'} aria-label={`Publish port ${item.port}`} title={item.probe==='http'?'Publish through Signal/HKMN':`Port is ${item.probe||'unverified'}; click for details`} onclick={()=>requestPublish(item)}><Globe2 size={14}/></button>{/if}</div>{#if route}<a class="public-url" href={route.url} target="_blank" rel="noreferrer">{route.url}</a>{/if}</article>
    {/each}
    {#if !busy&&!candidates.filter(item=>!item.stale).length}<div class="semantic-state">Scan this Device to find and verify listening HTTP services.</div>{/if}
  </div>
  <footer>{busy?'Working…':status||'Publication is explicit and can be stopped here.'}</footer>
</section>
{#if confirm}<div class="atlas-dialog-backdrop"><div class="atlas-dialog" role="dialog" aria-modal="true"><h2>Publish port {confirm.port}?</h2><p>This creates a public Signal/HKMN URL for the verified HTTP listener on {contextId}.</p><div><button onclick={()=>confirm=undefined}>Cancel</button><button onclick={()=>publish(confirm)}>Publish</button></div></div></div>{/if}
