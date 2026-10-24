<script lang="ts">
  import type {Component} from 'svelte';
  import ContextMenu from './ui/ContextMenu.svelte';
  import type {MenuEntry} from '../lib/menu.js';
  interface MenuAction {id:string;label:string;icon?:Component<any>;danger?:boolean;disabled?:boolean}
  export let x=0;export let y=0;export let actions:MenuAction[]=[];export let onrun:(id:string)=>void=()=>{};export let onclose:()=>void=()=>{};
  // Dangerous actions go last, after a divider.
  $: items=[...actions.filter(action=>!action.danger),'separator',...actions.filter(action=>action.danger)] as MenuEntry[];
</script>
<ContextMenu {x} {y} {items} {onrun} {onclose}/>
