<script lang="ts">
  import {onMount} from 'svelte';import type {AtlasPanelDescriptor} from '../lib/panel-registry.js';import {chooseContext,type WorkbenchState} from '../lib/workbench-state.js';import {loadContextCatalog} from '../lib/context-catalog.js';
  import Monitor from '@lucide/svelte/icons/monitor';import Search from '@lucide/svelte/icons/search';import FolderOpen from '@lucide/svelte/icons/folder-open';import SquareTerminal from '@lucide/svelte/icons/square-terminal';import Command from '@lucide/svelte/icons/command';import RefreshCw from '@lucide/svelte/icons/refresh-cw';import Settings2 from '@lucide/svelte/icons/settings-2';import BookOpen from '@lucide/svelte/icons/book-open';
  let minimizedNavigator=false;
  const restoreNavigator=()=>{(document.querySelector('.root-dock') as any)?.__atlasRestorePanel?.('atlas.navigator')};
  export let state:WorkbenchState;let contexts:any[]=[];let selected=state.snapshot().contextId;let loading=false;
  const label=(item:any)=>`${item.name}${item.device?.agentMode?` · ${item.device.agentMode}`:''}${item.device?.id?` · ${item.device.id.slice(0,8)}`:''}`;
  async function load(force=false){loading=true;try{const value=await loadContextCatalog(force,state.snapshot().connection.profile);contexts=value.contexts??[];selected=chooseContext(contexts,state.snapshot());state.setContext(selected,false);}finally{loading=false}}
  function choose(id:string){selected=id;state.setContext(id);window.dispatchEvent(new CustomEvent('atlas:context',{detail:id}));}
  onMount(()=>{minimizedNavigator=((document.querySelector('.root-dock') as any)?.__atlasMinimizedPanels??[]).some((item:AtlasPanelDescriptor)=>item.id==='atlas.navigator');const unsubscribe=state.subscribe(value=>selected=value.contextId);const panels=(event:Event)=>minimizedNavigator=((event as CustomEvent<any[]>).detail??[]).some(item=>item.id==='atlas.navigator');window.addEventListener('atlas:minimized-panels',panels);void load();return()=>{unsubscribe();window.removeEventListener('atlas:minimized-panels',panels)}});
</script>
<nav class="activity-rail context-rail" aria-label="Atlas activity">
  <button class="rail-brand" title="FNGK Atlas" aria-label="FNGK Atlas"><img src="/brand/fngk-mark.svg" alt=""/></button>
  <button title="Open Device lifecycle" aria-label="Open Device lifecycle" onclick={()=>window.dispatchEvent(new Event('atlas:open-device-lifecycle'))}><Settings2 size={17}/></button>
  <button title="Open documentation" aria-label="Open documentation" onclick={()=>window.dispatchEvent(new Event('atlas:open-documentation'))}><BookOpen size={17}/></button>
  <div class="rail-contexts" aria-label="FNGK contexts">{#each contexts as item}<button class:active={item.id===selected} class:offline={!item.online} data-context-id={item.id} data-context-kind={item.kind??'context'} title={label(item)} aria-label={label(item)} onclick={()=>choose(item.id)}><Monitor size={18}/><i class:online={item.online}></i></button>{/each}</div>
  {#if minimizedNavigator}<button aria-label="Restore Atlas" title="Restore explorer" onclick={restoreNavigator}><FolderOpen size={17}/></button>{/if}
  <span class="rail-spacer"></span>
  <button title="Search" aria-label="Search" onclick={()=>window.dispatchEvent(new Event('atlas:focus-search'))}><Search size={17}/></button>
  <button title="Open filesystem" aria-label="Open filesystem" onclick={()=>window.dispatchEvent(new CustomEvent('atlas:open-root',{detail:{contextId:selected,path:'/'}}))}><FolderOpen size={17}/></button>
  <button title="Open terminal" aria-label="Open terminal" onclick={()=>window.dispatchEvent(new Event('atlas:open-terminal'))}><SquareTerminal size={17}/></button>
  <button title="Open command palette" aria-label="Open command palette" onclick={()=>window.dispatchEvent(new Event('atlas:shortcuts'))}><Command size={17}/></button>
  <button class:loading title="Refresh FNGK namespace" aria-label="Refresh FNGK namespace" onclick={()=>load(true)}><RefreshCw size={15}/></button>
</nav>
