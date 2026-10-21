<script lang="ts">
  import {onMount} from 'svelte';
  import CircleEllipsis from '@lucide/svelte/icons/circle-ellipsis';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import type {WorkbenchState} from '../lib/workbench-state.js';
  import {loadContextCatalog} from '../lib/context-catalog.js';
  import {deviceLabelStore,resolveDeviceIdentity} from '../lib/device-identity.js';
  import {deviceAppearanceStore} from '../lib/device-appearance.js';
  import PermanentPanelHeader from './PermanentPanelHeader.svelte';

  export let state:WorkbenchState;
  let contexts:any[]=[];
  let loading=true;
  let refreshing=false;
  let selectedContextId=state.snapshot().contextId;
  let error='';
  let menuDevice:any;
  let appearanceRevision=0;
  // A reactive declaration, not a function: legacy template expressions only
  // re-run when a variable they name changes, so `deviceList` never updated the header.
  $: deviceList=contexts.filter(context=>context.kind==='fngk-device');
  // The machine running Atlas is a context too (local repositories, processes,
  // files); it is listed first so it stays selectable without being a Device.
  $: localContext=contexts.find(context=>context.kind==='local');
  // Connected Devices first; offline ones (often many retired phones) fold away.
  $: onlineDevices=deviceList.filter(device=>device.online);
  $: offlineDevices=deviceList.filter(device=>!device.online);
  const offlineKey='atlas.devices.show-offline';
  let showOffline=(()=>{try{const value=localStorage.getItem(offlineKey);return value===null?undefined:value==='true'}catch{return undefined}})();
  $: if(showOffline===undefined&&!loading)showOffline=onlineDevices.length===0;
  function toggleOffline(){showOffline=!showOffline;try{localStorage.setItem(offlineKey,String(showOffline))}catch{}}
  function ago(value:string){const seconds=Math.max(0,(Date.now()-Date.parse(value))/1000);if(!Number.isFinite(seconds))return 'unknown';if(seconds<90)return 'just now';const minutes=seconds/60;if(minutes<90)return `${Math.round(minutes)}m ago`;const hours=minutes/60;if(hours<36)return `${Math.round(hours)}h ago`;return `${Math.round(hours/24)}d ago`}
  // Only the first load replaces the list with a placeholder. Re-rendering it on
  // every refresh destroyed the card under the pointer, so the first click after
  // load (which itself publishes state) was lost.
  async function refresh(force=false){loading=!contexts.length;refreshing=true;error='';try{contexts=(await loadContextCatalog(force,state.snapshot().connection.profile)).contexts;}catch(value){error=(value as Error).message;}finally{loading=false;refreshing=false;}}
  function select(device:any){state.setContext(device.id);menuDevice=undefined;}
  function openTerminal(device:any){select(device);window.dispatchEvent(new CustomEvent('atlas:open-terminal',{detail:{contextId:device.id,target:device.id,title:device.name??'Terminal',newSession:true}}));}
  function browse(device:any){select(device);window.dispatchEvent(new Event('atlas:focus-files'));}
  function manage(device:any){select(device);window.dispatchEvent(new Event('atlas:open-device-lifecycle'));}
  function details(device:any){select(device);menuDevice=undefined;}
  onMount(()=>{void refresh();const unsubscribe=state.subscribe(value=>{selectedContextId=value.contextId;void refresh()}),appearanceChanged=()=>appearanceRevision++;const closeMenu=(event:KeyboardEvent)=>{if(event.key==='Escape'&&menuDevice)menuDevice=undefined};window.addEventListener('atlas:device-appearance-changed',appearanceChanged);window.addEventListener('keydown',closeMenu);return()=>{unsubscribe();window.removeEventListener('atlas:device-appearance-changed',appearanceChanged);window.removeEventListener('keydown',closeMenu)}});
</script>

{#snippet card(device:any)}{@const deviceId=device.device?.id??device.id}{@const identity=resolveDeviceIdentity(deviceId)}{@const label=deviceLabelStore.getLabel(deviceId)??identity.label}{@const color=appearanceRevision>=0?deviceAppearanceStore.get(deviceId).color??identity.color:identity.color}<article class="device-card" class:active={selectedContextId===device.id} class:offline={!device.online} style={`--atlas-device-color:var(--atlas-device-${color})`} oncontextmenu={(event)=>{event.preventDefault();menuDevice=device}}><button class="device-select" aria-label={`${label} ${device.name??device.id} ${device.online?'Online':'Offline'}`} onclick={()=>select(device)} title={`${label} · ${device.name??device.id}`}><b class="device-glyph">{identity.glyph}</b><span><strong>{label}</strong><small>{device.name??device.id}{#if !device.online && device.device?.lastSeenAt} · seen {ago(device.device.lastSeenAt)}{/if}</small></span><i class:online={device.online} aria-label={device.online?'Online':'Offline'}></i></button><button class="device-menu icon-button" title={`Actions for ${label}`} aria-label={`Actions for ${label}`} onclick={()=>menuDevice=menuDevice?.id===device.id?undefined:device}><CircleEllipsis size={14}/></button></article>{/snippet}

<section class="devices-panel" aria-label="Devices">
  <PermanentPanelHeader title="Devices" subtitle={`${onlineDevices.length} connected · ${deviceList.length} total`}><button class="icon-button" title="Refresh devices" aria-label="Refresh devices" onclick={()=>refresh(true)} disabled={refreshing}><RefreshCw size={14}/></button><button class="icon-button" title="Collapse Devices sidebar" aria-label="Collapse Devices sidebar" onclick={()=>window.dispatchEvent(new CustomEvent('atlas:toggle-sidebar-collapse',{detail:{panelId:'atlas.devices'}}))}>−</button></PermanentPanelHeader>
  {#if loading}<p class="devices-status">Discovering devices…</p>{:else if error}<p class="devices-error">{error}</p>{:else if !deviceList.length&&!localContext}<p class="devices-status">No FNGK devices discovered yet.</p>{:else}<div class="devices-list">{#if localContext}<article class="device-card local-card" class:active={selectedContextId===localContext.id}><button class="device-select" aria-label={`This computer ${localContext.name??'Atlas process host'} Online`} onclick={()=>select(localContext)} title={`This computer · ${localContext.name??'Atlas process host'}`}><b class="device-glyph">⌂</b><span><strong>This computer</strong><small>{localContext.name??'Atlas process host'}</small></span><i class="online" aria-label="Online"></i></button></article>{/if}{#if onlineDevices.length}<h3 class="device-group"><i class="online"></i>Connected <span>{onlineDevices.length}</span></h3>{#each onlineDevices as device (device.id)}{@render card(device)}{/each}{/if}{#if offlineDevices.length}<button class="device-group toggle" aria-expanded={showOffline} onclick={toggleOffline}><i></i>Offline <span>{offlineDevices.length}</span><em>{showOffline?'Hide':'Show'}</em></button>{#if showOffline}{#each offlineDevices as device (device.id)}{@render card(device)}{/each}{/if}{/if}</div>{/if}
  {#if menuDevice}{@const menuId=menuDevice.device?.id??menuDevice.id}{@const menuIdentity=resolveDeviceIdentity(menuId)}{@const menuLabel=deviceLabelStore.getLabel(menuId)??menuIdentity.label}<div class="device-actions" role="menu" aria-label={`Device profile for ${menuLabel}`}><header><b class="device-glyph">{menuIdentity.glyph}</b><span><strong>{menuLabel}</strong><small>{menuDevice.name??menuId}</small><small>{menuDevice.device?.platform??'Unknown platform'} · {menuDevice.online?'Online':'Offline'}</small></span></header><button role="menuitem" onclick={()=>openTerminal(menuDevice)}><SquareTerminal size={13}/>New terminal</button><button role="menuitem" onclick={()=>browse(menuDevice)}><FolderOpen size={13}/>Browse files</button><button role="menuitem" onclick={()=>details(menuDevice)}><CircleEllipsis size={13}/>Show details</button><button role="menuitem" onclick={()=>manage(menuDevice)}><CircleEllipsis size={13}/>Manage device</button></div>{/if}
</section>

<style>
  .devices-panel{position:relative;display:grid;min-height:0;height:100%;grid-template-rows:auto minmax(0,1fr);color:var(--atlas-text)}
  .icon-button{display:grid;place-items:center;width:26px;height:26px;padding:0}
  .devices-list{overflow:auto;display:grid;align-content:start;gap:3px;padding:5px}.device-card{display:grid;grid-template-columns:minmax(0,1fr) 28px;align-items:center;min-height:38px;border:1px solid var(--atlas-border);border-radius:6px;background:var(--atlas-surface-1)}.device-card:hover,.device-card.active{border-color:var(--atlas-device-color);box-shadow:inset 2px 0 var(--atlas-device-color)}.device-card.offline{opacity:.55}.device-card.offline .device-glyph{filter:grayscale(1)}
  .device-select{display:grid;grid-template-columns:26px minmax(0,1fr) 8px;gap:7px;align-items:center;width:100%;border:0;background:transparent;padding:4px 6px;text-align:left}.device-select span{min-width:0}.device-select span strong,.device-select span small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.device-select span strong{font-size:11px}.device-select span small{color:var(--atlas-muted);font-size:10px}.device-glyph{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:color-mix(in srgb,var(--atlas-device-color) 20%,transparent);color:var(--atlas-device-color);font-size:9px}.device-select i{width:6px;height:6px;border-radius:50%;background:var(--atlas-muted)}.device-select i.online{background:var(--atlas-success)}.device-menu{visibility:hidden}.device-card:hover .device-menu,.device-card.active .device-menu{visibility:visible}
  .device-group{display:flex;align-items:center;gap:6px;margin:6px 2px 2px;padding:0;border:0;background:none;color:var(--atlas-muted);font-family:inherit;font-size:9px;font-weight:600;line-height:1.4;letter-spacing:.08em;text-transform:uppercase;text-align:left}.device-group span{color:var(--atlas-text-soft)}.device-group i{width:6px;height:6px;border-radius:50%;background:var(--atlas-muted)}.device-group i.online{background:var(--atlas-success)}.device-group em{margin-left:auto;font-style:normal;font-weight:500;letter-spacing:0;text-transform:none}.device-group.toggle{cursor:pointer}.device-group.toggle:hover{color:var(--atlas-text)}
  .devices-status,.devices-error{margin:12px;color:var(--atlas-muted);font-size:11px}.devices-error{color:var(--atlas-danger)}.device-actions{position:absolute;z-index:3;top:43px;right:8px;display:grid;min-width:190px;padding:5px;border:1px solid var(--atlas-border);border-radius:6px;background:var(--atlas-surface);box-shadow:0 10px 24px rgb(0 0 0/.32)}.device-actions header{display:flex;gap:7px;padding:5px 5px 7px;border-bottom:1px solid var(--atlas-border)}.device-actions header span{min-width:0}.device-actions header strong,.device-actions header small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.device-actions header small{color:var(--atlas-muted);font-size:9px}.device-actions button{display:flex;gap:7px;align-items:center;border:0;border-radius:4px;background:transparent;padding:7px;text-align:left;font-size:11px}.device-actions button:hover{background:var(--atlas-hover)}
</style>
