<script lang="ts">
  import {onMount} from 'svelte';
  import CircleEllipsis from '@lucide/svelte/icons/circle-ellipsis';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import type {WorkbenchState} from '../lib/workbench-state.js';
  import {loadContextCatalog} from '../lib/context-catalog.js';
  import {resolveDeviceIdentity} from '../lib/device-identity.js';

  export let state:WorkbenchState;
  let contexts:any[]=[];
  let loading=true;
  let error='';
  let menuDevice:any;

  const devices=()=>contexts.filter(context=>context.kind==='fngk-device');
  async function refresh(force=false){
    loading=true;error='';
    try{contexts=(await loadContextCatalog(force,state.snapshot().connection.profile)).contexts;}
    catch(value){error=(value as Error).message;}
    finally{loading=false;}
  }
  function select(device:any){state.setContext(device.id);menuDevice=undefined;}
  function openTerminal(device:any){select(device);window.dispatchEvent(new CustomEvent('atlas:open-terminal',{detail:{contextId:device.id,target:device.id,title:device.name??'Terminal',newSession:true}}));}
  function browse(device:any){select(device);window.dispatchEvent(new Event('atlas:focus-files'));}
  function manage(device:any){select(device);window.dispatchEvent(new Event('atlas:open-device-lifecycle'));}
  onMount(()=>{void refresh();const unsubscribe=state.subscribe(()=>void refresh());return unsubscribe;});
</script>

<section class="devices-panel" aria-label="Devices">
  <header class="devices-header"><div><strong>Devices</strong><small>{devices().length} available</small></div><button class="icon-button" title="Refresh devices" aria-label="Refresh devices" onclick={()=>refresh(true)} disabled={loading}><RefreshCw size={14}/></button></header>
  {#if loading}<p class="devices-status">Discovering devices…</p>{:else if error}<p class="devices-error">{error}</p>{:else if !devices().length}<p class="devices-status">No FNGK devices discovered yet.</p>{:else}<div class="devices-list">{#each devices() as device (device.id)}{@const identity=resolveDeviceIdentity(device.device?.id??device.id)}<article class:active={state.snapshot().contextId===device.id} class:offline={!device.online} style={`--atlas-device-color:var(--atlas-device-${identity.color})`}><button class="device-select" onclick={()=>select(device)} oncontextmenu={(event)=>{event.preventDefault();menuDevice=device}} title={`${identity.label} · ${device.name??device.id}`}><b class="device-glyph">{identity.glyph}</b><span><strong>{identity.label}</strong><small>{device.name??device.id}</small></span><i class:online={device.online} aria-label={device.online?'Online':'Offline'}></i></button><button class="device-menu icon-button" title={`Actions for ${identity.label}`} aria-label={`Actions for ${identity.label}`} onclick={()=>menuDevice=menuDevice?.id===device.id?undefined:device}><CircleEllipsis size={14}/></button></article>{/each}</div>{/if}
  {#if menuDevice}<div class="device-actions" role="menu" aria-label="Device actions"><button role="menuitem" onclick={()=>openTerminal(menuDevice)}><SquareTerminal size={13}/>New terminal</button><button role="menuitem" onclick={()=>browse(menuDevice)}><FolderOpen size={13}/>Browse files</button><button role="menuitem" onclick={()=>manage(menuDevice)}><CircleEllipsis size={13}/>Manage device</button></div>{/if}
</section>

<style>
  .devices-panel{position:relative;display:grid;min-height:0;grid-template-rows:auto minmax(0,1fr);color:var(--atlas-text)}
  .devices-header{display:flex;align-items:center;justify-content:space-between;padding:10px 10px 8px;border-bottom:1px solid var(--atlas-border)}
  .devices-header strong{display:block;font-size:12px}.devices-header small{color:var(--atlas-muted);font-size:10px}.icon-button{display:grid;place-items:center;width:26px;height:26px;padding:0}
  .devices-list{overflow:auto;padding:6px}.devices-list article{display:grid;grid-template-columns:minmax(0,1fr) 28px;align-items:center;border:1px solid transparent;border-radius:6px}.devices-list article:hover,.devices-list article.active{border-color:var(--atlas-device-color);box-shadow:inset 2px 0 var(--atlas-device-color)}.devices-list article.offline{opacity:.62}
  .device-select{display:grid;grid-template-columns:26px minmax(0,1fr) 8px;gap:7px;align-items:center;width:100%;border:0;background:transparent;padding:7px;text-align:left}.device-select span{min-width:0}.device-select span strong,.device-select span small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.device-select span strong{font-size:11px}.device-select span small{color:var(--atlas-muted);font-size:10px}.device-glyph{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:color-mix(in srgb,var(--atlas-device-color) 20%,transparent);color:var(--atlas-device-color);font-size:9px}.device-select i{width:6px;height:6px;border-radius:50%;background:var(--atlas-muted)}.device-select i.online{background:var(--atlas-success)}.device-menu{visibility:hidden}.devices-list article:hover .device-menu,.devices-list article.active .device-menu{visibility:visible}
  .devices-status,.devices-error{margin:12px;color:var(--atlas-muted);font-size:11px}.devices-error{color:var(--atlas-danger)}.device-actions{position:absolute;z-index:3;top:43px;right:8px;display:grid;min-width:150px;padding:4px;border:1px solid var(--atlas-border);border-radius:6px;background:var(--atlas-surface);box-shadow:0 10px 24px rgb(0 0 0/.32)}.device-actions button{display:flex;gap:7px;align-items:center;border:0;border-radius:4px;background:transparent;padding:7px;text-align:left;font-size:11px}.device-actions button:hover{background:var(--atlas-hover)}
</style>
