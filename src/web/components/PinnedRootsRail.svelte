<script lang="ts">
  import {onMount} from 'svelte';import Pin from '@lucide/svelte/icons/pin';import FolderTree from '@lucide/svelte/icons/folder-tree';import WorkbenchContextMenu from './WorkbenchContextMenu.svelte';import type {WorkbenchState} from '../lib/workbench-state.js';import type {WorkspaceRoot,WorkspaceRootsStore} from '../lib/workspace-roots.js';
  export let state:WorkbenchState;export let roots:WorkspaceRootsStore;let contextId=state.snapshot().contextId;let items:WorkspaceRoot[]=[];let menu:{x:number;y:number;item:WorkspaceRoot}|undefined;
  const refresh=()=>items=roots.forContext(contextId);
  function open(item:WorkspaceRoot){window.dispatchEvent(new CustomEvent('atlas:open-root',{detail:Object.freeze({contextId:item.contextId,path:item.path})}));}
  function remove(){if(!menu)return;const event=menu.item.kind==='workspace'?'atlas:remove-workspace-root':'atlas:unpin-root';window.dispatchEvent(new CustomEvent(event,{detail:{contextId:menu.item.contextId,path:menu.item.path}}));menu=undefined}
  onMount(()=>{const stateUnsub=state.subscribe(value=>{contextId=value.contextId;refresh()}),rootsUnsub=roots.subscribe(refresh);return()=>{stateUnsub();rootsUnsub()}});
</script>
<nav class="pinned-roots-rail" aria-label="Pinned and workspace roots">
  <div class="roots-mark" title="Pinned folders"><Pin size={15}/></div>
  <div class="roots-list">{#each items as item}<button title={`${item.kind==='workspace'?'Workspace':'Pinned'} · ${item.path}`} aria-label={`${item.kind==='workspace'?'Workspace':'Pinned'} ${item.path}`} onclick={()=>open(item)} oncontextmenu={(event)=>{event.preventDefault();menu={x:event.clientX,y:event.clientY,item}}}>{#if item.kind==='workspace'}<FolderTree size={17}/>{:else}<Pin size={16}/>{/if}<span>{item.label??item.path.split('/').filter(Boolean).at(-1)??'/'}</span></button>{/each}</div>
  {#if !items.length}<small title="Pin a folder or add a workspace root from the filesystem menu">No roots</small>{/if}
</nav>
{#if menu}<WorkbenchContextMenu x={menu.x} y={menu.y} actions={[{id:'open',label:'Open root'},{id:'remove',label:menu.item.kind==='workspace'?'Remove workspace root':'Unpin folder',danger:true}]} onclose={()=>menu=undefined} onrun={(action)=>action==='open'?open(menu!.item):remove()}/>{/if}
