<script lang="ts">
  import {onMount} from 'svelte';
  import Workbench from './components/Workbench.svelte';
  import AtlasMenu from './components/AtlasMenu.svelte';
  import ActivityRail from './components/ActivityRail.svelte';
  import PinnedRootsRail from './components/PinnedRootsRail.svelte';
  import GlobalContextMenu from './components/GlobalContextMenu.svelte';
  import {createWorkbenchState} from './lib/workbench-state.js';
  import {WorkspaceRootsStore} from './lib/workspace-roots.js';
  let persisted:any={};try{persisted=JSON.parse(localStorage.getItem('atlas.state.v1')??'{}');}catch{}
  let persistedRoots:unknown=[];try{persistedRoots=JSON.parse(localStorage.getItem('atlas.workspace-roots.v1')??'[]')}catch{}
  const state=createWorkbenchState(persisted),roots=new WorkspaceRootsStore(persistedRoots);let snapshot=state.snapshot();
  onMount(()=>{const stateUnsub=state.subscribe(value=>{snapshot=value;localStorage.setItem('atlas.state.v1',JSON.stringify(state.persistable()));}),rootsUnsub=roots.subscribe(value=>localStorage.setItem('atlas.workspace-roots.v1',JSON.stringify(value)));const pin=(event:Event)=>roots.pin((event as CustomEvent<any>).detail),workspace=(event:Event)=>roots.addWorkspace((event as CustomEvent<any>).detail),unpin=(event:Event)=>roots.unpin((event as CustomEvent<any>).detail),remove=(event:Event)=>roots.removeWorkspace((event as CustomEvent<any>).detail);window.addEventListener('atlas:pin-root',pin);window.addEventListener('atlas:add-workspace-root',workspace);window.addEventListener('atlas:unpin-root',unpin);window.addEventListener('atlas:remove-workspace-root',remove);return()=>{stateUnsub();rootsUnsub();window.removeEventListener('atlas:pin-root',pin);window.removeEventListener('atlas:add-workspace-root',workspace);window.removeEventListener('atlas:unpin-root',unpin);window.removeEventListener('atlas:remove-workspace-root',remove)}});
</script>

<svelte:head><meta name="description" content="FNGK-native systems and code atlas"></svelte:head>
<div class="atlas-shell"><AtlasMenu {state}/><ActivityRail {state}/><Workbench {state} {roots}/><PinnedRootsRail {state} {roots}/><footer><span class:ok={snapshot.connection.phase==='connected'}>◆</span><b>{snapshot.connection.phase==='connected'?'FNGK connected':snapshot.connection.phase==='checking'?'Checking FNGK…':'FNGK disconnected'}</b><span>{snapshot.contextId}</span><span title={snapshot.connection.message}>{snapshot.connection.message}</span><span class="footer-route">effective route · no credentials stored</span><button title="Previous selection" onclick={()=>state.back()}>←</button><button title="Next selection" onclick={()=>state.forward()}>→</button></footer></div><GlobalContextMenu {state}/>
