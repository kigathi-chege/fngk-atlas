<script lang="ts">
  import {onMount} from 'svelte';import type {AtlasPanelDescriptor} from '../lib/panel-registry.js';import {chooseContext,type WorkbenchState} from '../lib/workbench-state.js';import {loadContextCatalog} from '../lib/context-catalog.js';
  import Search from '@lucide/svelte/icons/search';import FolderOpen from '@lucide/svelte/icons/folder-open';import SquareTerminal from '@lucide/svelte/icons/square-terminal';import Command from '@lucide/svelte/icons/command';import RefreshCw from '@lucide/svelte/icons/refresh-cw';import Settings2 from '@lucide/svelte/icons/settings-2';import BookOpen from '@lucide/svelte/icons/book-open';import Network from '@lucide/svelte/icons/network';import Bot from '@lucide/svelte/icons/bot';
  let minimizedNavigator=false;
  const restoreNavigator=()=>{(document.querySelector('.root-dock') as any)?.__atlasRestorePanel?.('atlas.navigator')};
  export let state:WorkbenchState;let selected=state.snapshot().contextId;let loading=false;
  async function load(force=false){loading=true;try{const value=await loadContextCatalog(force,state.snapshot().connection.profile);selected=chooseContext(value.contexts??[],state.snapshot());state.setContext(selected,false);}finally{loading=false}}
  onMount(()=>{minimizedNavigator=((document.querySelector('.root-dock') as any)?.__atlasMinimizedPanels??[]).some((item:AtlasPanelDescriptor)=>item.id==='atlas.navigator');const unsubscribe=state.subscribe(value=>selected=value.contextId);const panels=(event:Event)=>minimizedNavigator=((event as CustomEvent<any[]>).detail??[]).some(item=>item.id==='atlas.navigator');window.addEventListener('atlas:minimized-panels',panels);return()=>{unsubscribe();window.removeEventListener('atlas:minimized-panels',panels)}});
</script>
<nav class="activity-rail context-rail" aria-label="Atlas activity">
  <div class="activity-rail-top">
    <button class="rail-brand" title="FNGK Atlas" aria-label="FNGK Atlas"><img src="/brand/fngk-mark.svg" alt=""/></button>
    <button title="Open Devices" aria-label="Open Devices" onclick={()=>window.dispatchEvent(new Event('atlas:context'))}><Network size={17}/></button>
    <button title="Open Device lifecycle" aria-label="Open Device lifecycle" onclick={()=>window.dispatchEvent(new Event('atlas:open-device-lifecycle'))}><Settings2 size={17}/></button>
    <button title="Open Device Sessions" aria-label="Open Device Sessions" onclick={()=>window.dispatchEvent(new Event('atlas:open-device-sessions'))}><Network size={17}/></button>
    <button title="Open Agent Chat" aria-label="Open Agent Chat" onclick={()=>window.dispatchEvent(new Event('atlas:open-agent-chat'))}><Bot size={17}/></button>
    <button title="Manage app connections" aria-label="Manage app connections" onclick={()=>window.dispatchEvent(new Event('atlas:open-app-connections'))}><Network size={17}/></button>
    <button title="Open documentation" aria-label="Open documentation" onclick={()=>window.dispatchEvent(new Event('atlas:open-documentation'))}><BookOpen size={17}/></button>
    {#if minimizedNavigator}<button aria-label="Restore Atlas" title="Restore explorer" onclick={restoreNavigator}><FolderOpen size={17}/></button>{/if}
  </div>
  <div class="activity-rail-bottom">
    <button title="Search" aria-label="Search" onclick={()=>window.dispatchEvent(new Event('atlas:focus-search'))}><Search size={17}/></button>
    <button title="Open filesystem" aria-label="Open filesystem" onclick={()=>window.dispatchEvent(new CustomEvent('atlas:open-root',{detail:{contextId:selected,path:'/'}}))}><FolderOpen size={17}/></button>
    <button title="Open terminal" aria-label="Open terminal" onclick={()=>window.dispatchEvent(new Event('atlas:open-terminal'))}><SquareTerminal size={17}/></button>
    <button title="Open command palette" aria-label="Open command palette" onclick={()=>window.dispatchEvent(new Event('atlas:shortcuts'))}><Command size={17}/></button>
    <button class:loading title="Refresh FNGK namespace" aria-label="Refresh FNGK namespace" onclick={()=>load(true)}><RefreshCw size={15}/></button>
  </div>
</nav>
