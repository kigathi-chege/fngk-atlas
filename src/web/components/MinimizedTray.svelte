<script lang="ts">
  import PanelTopOpen from '@lucide/svelte/icons/panel-top-open';import PanelsTopLeft from '@lucide/svelte/icons/panels-top-left';import WorkbenchContextMenu from './WorkbenchContextMenu.svelte';import type {AtlasPanelDescriptor} from '../lib/panel-registry.js';
  export let items:AtlasPanelDescriptor[]=[];export let visibleCount=4;export let onrestore:(id:string)=>void=()=>{};export let onforget:(id:string)=>void=()=>{};let menu:{x:number;y:number;item:AtlasPanelDescriptor}|undefined;let overflow=false;
  $: shown=items.slice(-visibleCount).reverse();$: hidden=items.slice(0,Math.max(0,items.length-visibleCount)).reverse();
</script>
{#if items.length}<div class="minimized-tray" aria-label="Minimized panels">
  {#each shown as item}<button aria-label={`Restore ${item.title}`} title={`Restore ${item.title}`} onclick={()=>onrestore(item.id)} oncontextmenu={(event)=>{event.preventDefault();menu={x:event.clientX,y:event.clientY,item}}}><PanelTopOpen size={15}/><span>{item.title}</span></button>{/each}
  {#if hidden.length}<div class="minimized-overflow"><button aria-label={`${hidden.length} more minimized panels`} title={`${hidden.length} more minimized panels`} onclick={()=>overflow=!overflow}><PanelsTopLeft size={15}/><i>{hidden.length}</i></button>{#if overflow}<div role="menu">{#each hidden as item}<button role="menuitem" onclick={()=>{overflow=false;onrestore(item.id)}}><PanelTopOpen size={13}/><span>{item.title}</span></button>{/each}</div>{/if}</div>{/if}
</div>{/if}
{#if menu}<WorkbenchContextMenu x={menu.x} y={menu.y} actions={[{id:'restore',label:'Restore panel'},{id:'close',label:'Close panel',danger:true}]} onclose={()=>menu=undefined} onrun={(action)=>{if(action==='restore')onrestore(menu!.item.id);else onforget(menu!.item.id)}}/>{/if}
