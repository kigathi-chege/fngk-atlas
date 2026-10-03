<script lang="ts">
  import {onMount} from 'svelte'; import ChevronUp from '@lucide/svelte/icons/chevron-up'; import ChevronDown from '@lucide/svelte/icons/chevron-down';
  export let label='Devices';let viewport:HTMLDivElement, above=false, below=false;
  const refresh=()=>{if(!viewport)return;above=viewport.scrollTop>1;below=viewport.scrollTop+viewport.clientHeight<viewport.scrollHeight-1};
  const scroll=(direction:number)=>viewport?.scrollBy({top:direction*Math.max(48,viewport.clientHeight*.65),behavior:'smooth'});
  onMount(()=>{const observer=new ResizeObserver(refresh),mutations=new MutationObserver(refresh);observer.observe(viewport);mutations.observe(viewport,{childList:true,subtree:true});refresh();return()=>{observer.disconnect();mutations.disconnect()}});
</script>
<div class="rail-scroll-wrap">
  {#if above}<button class="rail-scroll-control before" aria-label={`Show earlier ${label}`} title={`Show earlier ${label}`} onclick={()=>scroll(-1)}><ChevronUp size={14}/></button>{/if}
  <div bind:this={viewport} class="rail-contexts" aria-label="FNGK contexts" onscroll={refresh}><slot/></div>
  {#if below}<button class="rail-scroll-control after" aria-label={`Show later ${label}`} title={`Show later ${label}`} onclick={()=>scroll(1)}><ChevronDown size={14}/></button>{/if}
</div>
<style>.rail-scroll-wrap{position:relative;display:flex;flex:1;min-height:0;width:100%}.rail-scroll-control{position:absolute!important;z-index:2;left:5px!important;width:28px!important;min-height:20px!important;background:var(--atlas-surface-2,#121a23)!important}.rail-scroll-control.before{top:0}.rail-scroll-control.after{bottom:0}</style>
