<script lang="ts">
  import {onMount} from 'svelte';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import type {AtlasPanelDescriptor} from '../lib/panel-registry.js';
  let items:AtlasPanelDescriptor[]=[];
  function restore(id:string){(document.querySelector('.root-dock') as any)?.__atlasRestorePanel?.(id)}
  onMount(()=>{items=((document.querySelector('.root-dock') as any)?.__atlasMinimizedPanels??[]).filter((item:AtlasPanelDescriptor)=>item.kind==='terminal');const update=(event:Event)=>items=((event as CustomEvent<AtlasPanelDescriptor[]>).detail??[]).filter(item=>item.kind==='terminal');window.addEventListener('atlas:minimized-panels',update);return()=>window.removeEventListener('atlas:minimized-panels',update)});
</script>
<nav class="terminal-dock" aria-label="Terminal dock">
  <span class="dock-caption"><SquareTerminal size={13}/>TERMINALS</span>
  <div class="terminal-dock-items">{#each items as item}<button onclick={()=>restore(item.id)} aria-label={`Restore ${item.title}`} title="Restore terminal"><i></i>{item.title}</button>{/each}</div>
  <button class="dock-open" title="Open terminal" aria-label="Open terminal dock" onclick={()=>window.dispatchEvent(new Event('atlas:open-terminal'))}>+</button>
</nav>
<style>
  .terminal-dock{height:30px;display:flex;align-items:center;gap:12px;padding:0 12px;background:var(--atlas-surface-0);border-top:1px solid var(--atlas-border);color:var(--atlas-muted);min-width:0}.dock-caption{display:flex;align-items:center;gap:7px;font-size:9px;letter-spacing:.1em}.terminal-dock-items{display:flex;gap:6px;overflow:auto;flex:1}.terminal-dock button{font-size:11px;padding:3px 9px;white-space:nowrap;background:var(--atlas-surface-2);color:var(--atlas-text);border:1px solid var(--atlas-border)}.terminal-dock i{display:inline-block;width:5px;height:5px;background:var(--atlas-cyan);border-radius:50%;margin-right:7px}.terminal-dock .dock-open{border:0;background:transparent;font-size:17px}
</style>
