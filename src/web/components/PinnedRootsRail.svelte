<script lang="ts">
  import {onMount} from 'svelte';
  import Pin from '@lucide/svelte/icons/pin';
  import FolderTree from '@lucide/svelte/icons/folder-tree';
  import MinimizedTray from './MinimizedTray.svelte';
  import WorkbenchContextMenu from './WorkbenchContextMenu.svelte';
  import type {AtlasPanelDescriptor} from '../lib/panel-registry.js';
  import type {WorkbenchState} from '../lib/workbench-state.js';
  import type {WorkspaceRoot,WorkspaceRootsStore} from '../lib/workspace-roots.js';

  export let state:WorkbenchState;export let roots:WorkspaceRootsStore;
  let rail:HTMLElement,contextId=state.snapshot().contextId,items:WorkspaceRoot[]=[],minimized:AtlasPanelDescriptor[]=[];
  let menu:{x:number;y:number;item:WorkspaceRoot}|undefined,maxMinimized=4;
  const refresh=()=>items=roots.forContext(contextId);
  const panelHost=()=>document.querySelector<HTMLElement>('.root-dock') as any;
  const restore=(id:string)=>panelHost()?.__atlasRestorePanel?.(id),forget=(id:string)=>panelHost()?.__atlasForgetPanel?.(id);
  function open(item:WorkspaceRoot){window.dispatchEvent(new CustomEvent('atlas:open-root',{detail:Object.freeze({contextId:item.contextId,path:item.path})}));}
  function remove(){if(!menu)return;const event=menu.item.kind==='workspace'?'atlas:remove-workspace-root':'atlas:unpin-root';window.dispatchEvent(new CustomEvent(event,{detail:{contextId:menu.item.contextId,path:menu.item.path}}));menu=undefined}
  onMount(()=>{
    try{const saved=panelHost()?.__atlasMinimizedPanels??[];if(Array.isArray(saved))minimized=saved.filter((item:AtlasPanelDescriptor)=>item.kind!=='terminal'&&item.id!=='atlas.navigator')}catch{}
    const measure=()=>maxMinimized=Math.max(1,Math.floor((rail.clientHeight-52-Math.min(items.length,5)*52)/44));
    const resize=new ResizeObserver(measure);resize.observe(rail);
    const stateUnsub=state.subscribe(value=>{contextId=value.contextId;refresh();measure()}),rootsUnsub=roots.subscribe(()=>{refresh();measure()});
    const panels=(event:Event)=>{minimized=[...((event as CustomEvent<AtlasPanelDescriptor[]>).detail??[])].filter(item=>item.kind!=='terminal'&&item.id!=='atlas.navigator');measure()};
    window.addEventListener('atlas:minimized-panels',panels);
    return()=>{resize.disconnect();stateUnsub();rootsUnsub();window.removeEventListener('atlas:minimized-panels',panels)};
  });
</script>
<nav bind:this={rail} class="pinned-roots-rail" aria-label="Pinned, workspace, and minimized panels">
  <div class="roots-mark" title="Pinned folders"><Pin size={15}/></div>
  <div class="roots-list">{#each items as item}<button title={`${item.kind==='workspace'?'Workspace':'Pinned'} · ${item.path}`} aria-label={`${item.kind==='workspace'?'Workspace':'Pinned'} ${item.path}`} onclick={()=>open(item)} oncontextmenu={(event)=>{event.preventDefault();menu={x:event.clientX,y:event.clientY,item}}}>{#if item.kind==='workspace'}<FolderTree size={17}/>{:else}<Pin size={16}/>{/if}<span>{item.label??item.path.split('/').filter(Boolean).at(-1)??'/'}</span></button>{/each}</div>
  {#if !items.length}<small title="Pin a folder or add a workspace root from the filesystem menu">No roots</small>{/if}
  <span class="rail-fill"></span>
  <MinimizedTray items={minimized} visibleCount={maxMinimized} onrestore={restore} onforget={forget}/>
</nav>
{#if menu}<WorkbenchContextMenu x={menu.x} y={menu.y} actions={[{id:'open',label:'Open root'},{id:'remove',label:menu.item.kind==='workspace'?'Remove workspace root':'Unpin folder',danger:true}]} onclose={()=>menu=undefined} onrun={(action)=>action==='open'?open(menu!.item):remove()}/>{/if}
