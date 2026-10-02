<script lang="ts">
  import {onMount} from 'svelte';
  import {api} from '../lib/api.js';
  import type {WorkbenchState} from '../lib/workbench-state.js';
  import type {DeviceReadiness} from '../../lifecycle/service.js';import DocumentationHelp from './DocumentationHelp.svelte';
  export let state:WorkbenchState;
  let contextId='',profile='',loading=false,error='',value:DeviceReadiness|undefined;
  let sequence=0;
  const labels:Record<string,string>={'ready':'Ready','offline':'Device offline','needs-login':'Sign in required','needs-profile':'Select a profile','inspection-unavailable':'Remote inspection unavailable','needs-daemon':'Daemon recovery required','needs-pairing':'Pairing required'};
  async function refresh(){
    const request=++sequence;value=undefined;error='';
    if(!contextId.startsWith('device:'))return;
    loading=true;
    try{const result=await api<DeviceReadiness>('/api/device-lifecycle?'+new URLSearchParams({contextId,...(profile?{profile}:{})}));if(request===sequence)value=result}
    catch(cause){if(request===sequence)error=(cause as Error).message}
    finally{if(request===sequence)loading=false}
  }
  onMount(()=>{const unsubscribe=state.subscribe(snapshot=>{const next=snapshot.connection.profile??'';if(snapshot.contextId!==contextId||next!==profile){contextId=snapshot.contextId;profile=next;void refresh()}});return()=>{sequence++;unsubscribe()}});
</script>
<DocumentationHelp topicId="recovery" label="Recovery documentation"/>
<section class="device-lifecycle-panel" aria-label="Device lifecycle">
  <header><small>DEVICE MANAGEMENT</small><h2>{contextId.startsWith('device:')?'Connection & recovery':'Select a Device'}</h2><p class="identity">{contextId}</p></header>
  {#if contextId.startsWith('device:')}
    <div class="readiness" aria-live="polite"><h3>{loading?'Inspecting connection…':error?'Inspection failed':labels[value?.state??'']??'Readiness unavailable'}</h3>
      {#if error}<p role="alert">{error}</p>{/if}
      {#each value?.diagnostics??[] as diagnostic}<p>{diagnostic.message}</p>{/each}
    </div>
    {#if value?.profiles.length}<label>Atlas operator profile<select aria-label="Lifecycle profile" bind:value={profile} onchange={refresh}><option value="">Choose profile</option>{#each value.profiles as item}<option value={item.name}>{item.name}{item.operatorAuthorized?' · authorized':' · sign-in needed'}</option>{/each}</select></label>
      <small>Profiles belong to this Atlas host. They do not report the remote Device's daemon state.</small>
    {/if}
    <div class="actions"><button onclick={refresh} disabled={loading}>Refresh readiness</button><button onclick={()=>window.dispatchEvent(new Event('atlas:recover'))}>Connection setup</button><button onclick={()=>window.dispatchEvent(new CustomEvent('atlas:open-fngk-handoff',{detail:{contextId}}))}>Update FNGK</button><button onclick={()=>window.dispatchEvent(new CustomEvent('atlas:open-ports',{detail:{contextId}}))}>Published ports</button></div>
    <p class="safety">Device retirement, deletion, and remote repair require a verified FNGK control-plane capability. Atlas will not substitute an unverified shell command or silently delete a Device.</p>
  {:else}<p>Choose a Device from the left rail. This panel follows your selection.</p><button onclick={()=>window.dispatchEvent(new Event('atlas:recover'))}>Connection setup</button>{/if}
</section>
<style>
  .device-lifecycle-panel{height:100%;overflow:auto;box-sizing:border-box;padding:24px;display:flex;flex-direction:column;gap:18px;background:var(--atlas-surface-0);color:var(--atlas-text)}header small{color:var(--atlas-cyan);font-size:10px;letter-spacing:.14em}h2{margin:6px 0;font-size:20px}h3{margin:0 0 8px;font-size:14px}p,section>small{margin:0;color:var(--atlas-muted);font-size:12px;line-height:1.65}.identity{font-family:monospace;overflow-wrap:anywhere}.readiness{padding:16px;border-left:2px solid var(--atlas-cyan);background:var(--atlas-surface-1)}label{display:grid;gap:8px;font-size:12px;max-width:360px}select{padding:8px}.actions{display:flex;gap:8px;flex-wrap:wrap}button{padding:8px 12px}.safety{max-width:640px}
</style>
