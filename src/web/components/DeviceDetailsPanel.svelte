<script lang="ts">
  import {onMount} from 'svelte';
  import type {WorkbenchState} from '../lib/workbench-state.js';
  import {loadContextCatalog} from '../lib/context-catalog.js';
  import {deviceLabelStore,resolveDeviceIdentity} from '../lib/device-identity.js';
  export let state:WorkbenchState;
  let device:any;let label='';let editing=false;
  async function refresh(){const catalog=await loadContextCatalog(false,state.snapshot().connection.profile);device=catalog.contexts.find((item:any)=>item.id===state.snapshot().contextId&&item.kind==='fngk-device');label=device?.device?.id?deviceLabelStore.getLabel(device.device.id)??resolveDeviceIdentity(device.device.id).label:'';}
  function save(){if(device?.device?.id)deviceLabelStore.setLabel(device.device.id,label);editing=false;}
  onMount(()=>{void refresh();return state.subscribe(()=>void refresh())});
</script>
<section class="device-details" aria-label="Device details">
  {#if device}{@const identity=resolveDeviceIdentity(device.device.id)}
    <header><b class="glyph" style={`--atlas-device-color:var(--atlas-device-${identity.color})`}>{identity.glyph}</b><div><strong>{deviceLabelStore.getLabel(device.device.id)??identity.label}</strong><small>{device.name}</small></div></header>
    {#if editing}<form onsubmit={(event)=>{event.preventDefault();save()}}><input bind:value={label} aria-label="Device label" maxlength="32"/><button>Save</button><button type="button" onclick={()=>editing=false}>Cancel</button></form>{:else}<div class="actions"><button class="rename" onclick={()=>editing=true}>Rename Atlas label</button><button onclick={()=>window.dispatchEvent(new Event('atlas:open-device-lifecycle'))}>Manage Device</button></div>{/if}
    <dl><div><dt>State</dt><dd>{device.online?'Online':'Offline'}</dd></div><div><dt>Platform</dt><dd>{device.device?.platform??'Unknown'}</dd></div><div><dt>Device ID</dt><dd>{device.device?.id}</dd></div></dl>
  {:else}<p>Select an FNGK device to inspect its local Atlas identity and connection state.</p>{/if}
</section>
<style>.device-details{padding:10px;font-size:11px}.device-details header{display:flex;gap:8px;align-items:center}.glyph{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;color:var(--atlas-device-color);background:color-mix(in srgb,var(--atlas-device-color) 20%,transparent)}small,dt,p{color:var(--atlas-muted)}small{display:block}.device-details form,.actions{display:flex;gap:4px;margin-top:10px}.device-details input{min-width:0;flex:1}.rename{margin-top:0}dl{margin:10px 0;display:grid;gap:7px}dl div{display:grid;grid-template-columns:70px 1fr;gap:6px}dt,dd{margin:0}dd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style>
