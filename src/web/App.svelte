<script lang="ts">
  import {onMount} from 'svelte';
  import Workbench from './components/Workbench.svelte';
  import AtlasMenu from './components/AtlasMenu.svelte';
  import {createWorkbenchState} from './lib/workbench-state.js';
  let persisted:any={};try{persisted=JSON.parse(localStorage.getItem('atlas.state.v1')??'{}');}catch{}
  const state=createWorkbenchState(persisted);let snapshot=state.snapshot();
  onMount(()=>state.subscribe(value=>{snapshot=value;localStorage.setItem('atlas.state.v1',JSON.stringify(state.persistable()));}));
</script>

<svelte:head><meta name="description" content="FNGK-native systems and code atlas"></svelte:head>
<div class="atlas-shell"><AtlasMenu {state}/><Workbench {state}/><footer><span class:ok={snapshot.connection.phase==='connected'}>◆</span><b>{snapshot.connection.phase==='connected'?'FNGK connected':snapshot.connection.phase==='checking'?'Checking FNGK…':'FNGK disconnected'}</b><span>{snapshot.contextId}</span><span title={snapshot.connection.message}>{snapshot.connection.message}</span><span class="footer-route">effective route · no credentials stored</span><button title="Previous selection" onclick={()=>state.back()}>←</button><button title="Next selection" onclick={()=>state.forward()}>→</button></footer></div>
