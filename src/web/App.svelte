<script lang="ts">
 import {onMount} from 'svelte';import Navigator from './components/Navigator.svelte';import Workbench from './components/Workbench.svelte';import FileExplorer from './components/FileExplorer.svelte';import {createWorkbenchState} from './lib/workbench-state.js';
 let persisted:any={};try{persisted=JSON.parse(localStorage.getItem('atlas.state.v1')??'{}');}catch{}const state=createWorkbenchState(persisted);let snapshot=state.snapshot();
 let leftWidth=Number(localStorage.getItem('atlas.left-width')??260),rightWidth=Number(localStorage.getItem('atlas.right-width')??310),leftCollapsed=false,rightCollapsed=false;let dragging:''|'left'|'right'='';
 function startResize(kind:'left'|'right',event:PointerEvent){dragging=kind;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)}
 function resize(event:PointerEvent){if(!dragging)return;const next=dragging==='left'?Math.min(420,Math.max(190,event.clientX)):Math.min(520,Math.max(230,window.innerWidth-event.clientX));if(dragging==='left'){leftWidth=next;localStorage.setItem('atlas.left-width',String(next))}else{rightWidth=next;localStorage.setItem('atlas.right-width',String(next))}}
 function endResize(){dragging=''}
 onMount(()=>state.subscribe(value=>{snapshot=value;localStorage.setItem('atlas.state.v1',JSON.stringify(state.persistable()));}));
</script>
<svelte:head><meta name="description" content="FNGK-native systems and code atlas"></svelte:head><svelte:window onpointermove={resize} onpointerup={endResize}/>
<div class="shell" class:left-collapsed={leftCollapsed} class:right-collapsed={rightCollapsed} style={`--left-width:${leftWidth}px;--right-width:${rightWidth}px`}>
 <Navigator {state} collapsed={leftCollapsed} ontoggle={()=>leftCollapsed=!leftCollapsed}/><div class="splitter left-splitter" role="separator" aria-label="Resize navigator" onpointerdown={(event)=>startResize('left',event)}></div><Workbench {state}/><div class="splitter right-splitter" role="separator" aria-label="Resize filesystem" onpointerdown={(event)=>startResize('right',event)}></div><FileExplorer {state} collapsed={rightCollapsed} ontoggle={()=>rightCollapsed=!rightCollapsed}/>
 <footer><span class:ok={snapshot.connection.phase==='connected'}>◆</span><b>{snapshot.connection.phase==='connected'?'FNGK connected':snapshot.connection.phase==='checking'?'Checking FNGK…':'FNGK disconnected'}</b><span>{snapshot.contextId}</span><span title={snapshot.connection.message}>{snapshot.connection.message}</span><span class="footer-route">effective route · no credentials stored</span><button title="Previous selection" onclick={()=>state.back()}>←</button><button title="Next selection" onclick={()=>state.forward()}>→</button></footer>
</div>
