<script lang="ts">
 import {onMount} from 'svelte';import Navigator from './components/Navigator.svelte';import Workbench from './components/Workbench.svelte';import FileExplorer from './components/FileExplorer.svelte';import {createWorkbenchState} from './lib/workbench-state.js';
 let persisted:any={};try{persisted=JSON.parse(localStorage.getItem('atlas.state.v1')??'{}');}catch{}const state=createWorkbenchState(persisted);let snapshot=state.snapshot();let online=true;
 onMount(()=>state.subscribe(value=>{snapshot=value;localStorage.setItem('atlas.state.v1',JSON.stringify(state.persistable()));}));
</script>
<svelte:head><meta name="description" content="FNGK-native systems and code atlas"></svelte:head>
<div class="shell"><Navigator {state}/><Workbench {state}/><FileExplorer {state}/><footer><span class:ok={online}>◆</span><b>{online?'Atlas ready':'Disconnected'}</b><span>{snapshot.contextId}</span><span class="footer-route">FNGK-native · no credentials stored</span><button onclick={()=>state.back()}>←</button><button onclick={()=>state.forward()}>→</button></footer></div>
