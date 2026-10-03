<script lang="ts">
  import {onMount} from 'svelte';
  import {api} from '../lib/api.js';
  import type {WorkbenchState} from '../lib/workbench-state.js';
  import type {DeviceReadiness} from '../../lifecycle/service.js';import DocumentationHelp from './DocumentationHelp.svelte';import {atlasDeviceColors,deviceAppearanceStore,type AtlasDeviceColor} from '../lib/device-appearance.js';
  export let state:WorkbenchState;
  let contextId='',profile='',loading=false,error='',value:DeviceReadiness|undefined;
  let sequence=0;let action:''|'disconnect'|'retire'|'delete'='';let removalDialog=false;let confirmation='';let acting=false;
  const labels:Record<string,string>={'ready':'Ready','offline':'Device offline','needs-login':'Sign in required','needs-profile':'Select a profile','inspection-unavailable':'Remote inspection unavailable','needs-daemon':'Daemon recovery required','needs-pairing':'Pairing required'};
  async function refresh(){
    const request=++sequence;value=undefined;error='';
    if(!contextId.startsWith('device:'))return;
    loading=true;
    try{const result=await api<DeviceReadiness>('/api/device-lifecycle?'+new URLSearchParams({contextId,...(profile?{profile}:{})}));if(request===sequence)value=result}
    catch(cause){if(request===sequence)error=(cause as Error).message}
    finally{if(request===sequence)loading=false}
  }
  const deviceId=()=>contextId.slice('device:'.length);const color=()=>deviceAppearanceStore.get(deviceId()).color??'';
  async function runAction(){if(!action)return;const current=action;acting=true;error='';try{await api(current==='delete'?'/api/device-lifecycle/device':`/api/device-lifecycle/${current}`,{method:current==='delete'?'DELETE':'POST',body:JSON.stringify({contextId,profile,confirm:true,...(current==='delete'?{confirmation}: {})})});action='';confirmation='';await refresh()}catch(cause){error=(cause as Error).message}finally{acting=false}}
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
    <label>Device color<select aria-label="Device color" value={color()} onchange={(event)=>{const next=(event.currentTarget as HTMLSelectElement).value;if(next)deviceAppearanceStore.set(deviceId(),next as AtlasDeviceColor);else deviceAppearanceStore.clear(deviceId())}}><option value="">Default</option>{#each atlasDeviceColors as item}<option value={item}>{item}</option>{/each}</select></label>
    <div class="actions"><button onclick={refresh} disabled={loading}>Refresh readiness</button><button onclick={()=>window.dispatchEvent(new Event('atlas:recover'))}>Connection setup</button><button onclick={()=>window.dispatchEvent(new CustomEvent('atlas:open-fngk-handoff',{detail:{contextId}}))}>Update FNGK</button><button onclick={()=>window.dispatchEvent(new CustomEvent('atlas:open-ports',{detail:{contextId}}))}>Published ports</button><button onclick={()=>action='disconnect'} disabled={!value?.capabilities.disconnect.available}>Disconnect</button><button class="danger" onclick={()=>removalDialog=true}>Remove Device…</button></div>
    {#each Object.entries(value?.capabilities??{}) as [name,capability]}{#if !capability.available}<small>{name}: {capability.reason}</small>{/if}{/each}
    <p class="safety">Retirement and deletion require a verified FNGK control-plane capability. Atlas never substitutes a shell command or silently deletes a Device.</p>
    {#if removalDialog}<div class="atlas-dialog-backdrop"><div class="atlas-dialog" role="dialog" aria-modal="true"><h2>Remove Device</h2><p>Choose the lifecycle operation. Atlas shows unavailable operations rather than emulating them.</p><div><button onclick={()=>{removalDialog=false;action='retire'}} disabled={!value?.capabilities.retire.available}>Retire Device</button><button class="danger" onclick={()=>{removalDialog=false;action='delete'}} disabled={!value?.capabilities.delete.available}>Delete permanently</button><button onclick={()=>removalDialog=false}>Cancel</button></div></div></div>{/if}
    {#if action}<div class="atlas-dialog-backdrop"><form class="atlas-dialog" onsubmit={(event)=>{event.preventDefault();void runAction()}}><h2>{action==='disconnect'?'Disconnect from Atlas':action==='retire'?'Retire Device':'Delete Device permanently'}</h2><p>{action==='disconnect'?'This releases Atlas’s local route. The Device remains paired and can be reconnected.':action==='retire'?'Retirement is a control-plane operation and may be unavailable.':'This cannot be undone.'}</p>{#if action==='delete'}<label>Type <code>{contextId}</code> to confirm<input bind:value={confirmation} required/></label>{/if}<div><button type="button" onclick={()=>{action='';confirmation=''}}>Cancel</button><button class:danger={action!=='disconnect'} disabled={acting||action==='delete'&&confirmation!==contextId}>{acting?'Working…':action==='disconnect'?'Disconnect':action==='retire'?'Retire':'Delete permanently'}</button></div></form></div>{/if}
  {:else}<p>Choose a Device from the left rail. This panel follows your selection.</p><button onclick={()=>window.dispatchEvent(new Event('atlas:recover'))}>Connection setup</button>{/if}
</section>
<style>
  .device-lifecycle-panel{height:100%;overflow:auto;box-sizing:border-box;padding:24px;display:flex;flex-direction:column;gap:18px;background:var(--atlas-surface-0);color:var(--atlas-text)}header small{color:var(--atlas-cyan);font-size:10px;letter-spacing:.14em}h2{margin:6px 0;font-size:20px}h3{margin:0 0 8px;font-size:14px}p,section>small{margin:0;color:var(--atlas-muted);font-size:12px;line-height:1.65}.identity{font-family:monospace;overflow-wrap:anywhere}.readiness{padding:16px;border-left:2px solid var(--atlas-cyan);background:var(--atlas-surface-1)}label{display:grid;gap:8px;font-size:12px;max-width:360px}select{padding:8px}.actions{display:flex;gap:8px;flex-wrap:wrap}button{padding:8px 12px}.safety{max-width:640px}
</style>
