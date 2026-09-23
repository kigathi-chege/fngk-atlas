<script lang="ts">
  interface MenuAction {id:string;label:string;danger?:boolean;disabled?:boolean}
  export let x=0;export let y=0;export let actions:MenuAction[]=[];export let onrun:(id:string)=>void=()=>{};export let onclose:()=>void=()=>{};
  function run(action:MenuAction){if(!action.disabled){onrun(action.id);onclose()}}
</script>
<svelte:window onkeydown={(event)=>event.key==='Escape'&&onclose()} onclick={(event)=>{if(!(event.target as HTMLElement).closest('.workbench-context-menu'))onclose()}}/>
<div class="workbench-context-menu" role="menu" style={`left:${Math.min(x,innerWidth-220)}px;top:${Math.min(y,innerHeight-actions.length*31-12)}px`}>
  {#each actions as action}<button role="menuitem" class:danger={action.danger} disabled={action.disabled} onclick={()=>run(action)}>{action.label}</button>{/each}
</div>
