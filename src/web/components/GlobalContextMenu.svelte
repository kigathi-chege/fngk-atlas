<script lang="ts">
 import {onMount} from 'svelte';import type {WorkbenchSnapshot,WorkbenchState} from '../lib/workbench-state.js';import {contextActions,type ContextAction} from '../lib/context-actions.js';
 import ContextMenu from './ui/ContextMenu.svelte';import {contextActionEntries} from '../lib/context-menu-items.js';
 export let state:WorkbenchState;let menu:{x:number;y:number;actions:ContextAction[];snapshot:WorkbenchSnapshot}|undefined;
 const close=()=>menu=undefined;
 function run(id:string){const action=menu?.actions.find(value=>value.id===id);if(menu&&action)action.run(menu.snapshot)}
 $: items=menu?contextActionEntries(menu.actions):[];
 onMount(()=>{
  // A panel that shows its own menu (Devices, files, pinned roots) prevents the default; leave those alone.
  const context=(event:MouseEvent)=>{if(event.defaultPrevented)return;const target=event.target as HTMLElement;if(target.closest('input,textarea,select,iframe,.xterm,.cm-editor,.atlas-popup,.dv-tab,.file-list,[contenteditable="true"]'))return;const contextTarget=target.closest<HTMLElement>('[data-context-id]'),base=state.snapshot(),contextId=contextTarget?.dataset.contextId??base.contextId,snapshot={...base,contextId,selection:contextTarget?{id:contextId,type:contextTarget.dataset.contextKind??'context'}:base.selection},actions=contextActions.filter(action=>action.available(snapshot));if(!actions.length)return;event.preventDefault();menu={x:event.clientX,y:event.clientY,actions,snapshot}};
  document.addEventListener('contextmenu',context);return()=>document.removeEventListener('contextmenu',context);
 });
</script>
{#if menu}<ContextMenu x={menu.x} y={menu.y} {items} label="Workspace actions" onrun={run} onclose={close}/>{/if}
