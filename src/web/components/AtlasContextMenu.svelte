<script lang="ts">
 import ExternalLink from '@lucide/svelte/icons/external-link';import Pin from '@lucide/svelte/icons/pin';import Copy from '@lucide/svelte/icons/copy';import FolderOpen from '@lucide/svelte/icons/folder-open';
 export let x=0;export let y=0;export let item:any;export let onclose:()=>void=()=>{};export let onrun:(action:string)=>void=()=>{};
 const actions=()=>item?.type==='directory'?[['open','Open folder',FolderOpen],['workspace','Add to workspace',Pin],['copy','Copy path',Copy]] as const:[['open','Open file',ExternalLink],['pin','Pin file',Pin],['copy','Copy path',Copy]] as const;
 function run(id:string){onrun(id);onclose()}
</script>
<svelte:window onkeydown={(event)=>event.key==='Escape'&&onclose()} onclick={(event)=>{if(!(event.target as HTMLElement).closest('.atlas-context-menu'))onclose()}}/>
<div class="atlas-context-menu" role="menu" style={`left:${Math.min(x,innerWidth-220)}px;top:${Math.min(y,innerHeight-180)}px`}>{#each actions() as action}{@const Icon=action[2]}<button role="menuitem" onclick={()=>run(action[0])}><Icon size={14}/><span>{action[1]}</span></button>{/each}</div>
<style>.atlas-context-menu{position:fixed;z-index:1000;width:190px;border:1px solid #354252;border-radius:5px;background:#111821;padding:4px;box-shadow:0 16px 45px #000b}.atlas-context-menu button{display:flex;width:100%;align-items:center;gap:8px;border:0;background:transparent;padding:7px 8px;text-align:left;font-size:11px}.atlas-context-menu button:hover,.atlas-context-menu button:focus-visible{background:#1b2733;color:var(--accent);outline:none}.atlas-context-menu span{flex:1}</style>
