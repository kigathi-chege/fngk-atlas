<script lang="ts">
  import {onMount} from 'svelte';
  import type {WorkbenchState} from '../lib/workbench-state.js';
  import {loadContextCatalog} from '../lib/context-catalog.js';
  import {deviceLabelStore,resolveDeviceIdentity} from '../lib/device-identity.js';
  import {deviceAppearanceStore} from '../lib/device-appearance.js';
  export let state:WorkbenchState;
  let device:any;let label='';let editing=false;let appearanceRevision=0;
  async function refresh(){const catalog=await loadContextCatalog(false,state.snapshot().connection.profile);device=catalog.contexts.find((item:any)=>item.id===state.snapshot().contextId&&item.kind==='fngk-device');label=device?.device?.id?deviceLabelStore.getLabel(device.device.id)??resolveDeviceIdentity(device.device.id).label:'';}
  function save(){if(device?.device?.id)deviceLabelStore.setLabel(device.device.id,label);editing=false;}
  onMount(()=>{void refresh();const unsubscribe=state.subscribe(()=>void refresh()),appearanceChanged=()=>appearanceRevision++;window.addEventListener('atlas:device-appearance-changed',appearanceChanged);return()=>{unsubscribe();window.removeEventListener('atlas:device-appearance-changed',appearanceChanged)}});
</script>
<section class="device-details" aria-label="Device details">
  <header class="device-details-header"><strong>Device details</strong><button class="collapse" title="Collapse device details" aria-label="Collapse device details" onclick={()=>window.dispatchEvent(new CustomEvent('atlas:toggle-panel-collapse',{detail:{panelId:'atlas.device-details'}}))}>−</button></header>
  {#if device}{@const identity=resolveDeviceIdentity(device.device.id)}{@const color=appearanceRevision>=0?deviceAppearanceStore.get(device.device.id).color??identity.color:identity.color}
    <div class="device-profile"><b class="glyph" style={`--atlas-device-color:var(--atlas-device-${color})`}>{identity.glyph}</b><div><strong>{deviceLabelStore.getLabel(device.device.id)??identity.label}</strong><small>{device.name}</small></div></div>
    {#if editing}<form onsubmit={(event)=>{event.preventDefault();save()}}><input bind:value={label} aria-label="Device label" maxlength="32"/><button>Save</button><button type="button" onclick={()=>editing=false}>Cancel</button></form>{:else}<div class="actions"><button class="rename" onclick={()=>editing=true}>Rename Atlas label</button><button onclick={()=>window.dispatchEvent(new Event('atlas:open-device-lifecycle'))}>Manage Device</button></div>{/if}
    <dl><div><dt>State</dt><dd>{device.online?'Online':'Offline'}</dd></div><div><dt>Platform</dt><dd>{device.device?.platform??'Unknown'}</dd></div><div><dt>Device ID</dt><dd>{device.device?.id}</dd></div></dl>
  {:else}<p>Select an FNGK device to inspect its local Atlas identity and connection state.</p>{/if}
</section>
<style>.device-details{height:100%;padding:0 10px;overflow:hidden;font-size:11px}.device-details-header{height:36px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--atlas-border)}.device-profile{display:flex;gap:8px;align-items:center;padding-top:10px}.device-profile>div{min-width:0;flex:1}.collapse{width:24px;height:24px;border:0;background:transparent} .glyph{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;color:var(--atlas-device-color);background:color-mix(in srgb,var(--atlas-device-color) 20%,transparent)}small,dt,p{color:var(--atlas-muted)}small{display:block}.device-details form,.actions{display:flex;gap:4px;margin-top:10px}.device-details input{min-width:0;flex:1}.rename{margin-top:0}dl{margin:10px 0;display:grid;gap:7px}dl div{display:grid;grid-template-columns:70px 1fr;gap:6px}dt,dd{margin:0}dd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style>
