<script lang="ts">
 import ExternalLink from '@lucide/svelte/icons/external-link';import Pin from '@lucide/svelte/icons/pin';import Copy from '@lucide/svelte/icons/copy';import FolderOpen from '@lucide/svelte/icons/folder-open';import FolderTree from '@lucide/svelte/icons/folder-tree';import FilePlus from '@lucide/svelte/icons/file-plus';import FolderPlus from '@lucide/svelte/icons/folder-plus';import Pencil from '@lucide/svelte/icons/pencil';import Trash2 from '@lucide/svelte/icons/trash-2';import Delete from '@lucide/svelte/icons/delete';import RotateCw from '@lucide/svelte/icons/rotate-cw';
 import ContextMenu from './ui/ContextMenu.svelte';import type {MenuEntry} from '../lib/menu.js';
 export let x=0;export let y=0;export let item:any;export let onclose:()=>void=()=>{};export let onrun:(action:string)=>void=()=>{};
 const remove:MenuEntry[]=['separator',{id:'trash',label:'Move to trash',icon:Trash2},{id:'delete',label:'Delete permanently',icon:Delete,danger:true}];
 const actions=(value:typeof item):MenuEntry[]=>value?.type==='background'
  ?[{id:'new-file',label:'New file',icon:FilePlus},{id:'new-directory',label:'New folder',icon:FolderPlus},'separator',{id:'pin',label:'Pin current folder',icon:Pin},{id:'workspace',label:'Add workspace root',icon:FolderTree},'separator',{id:'refresh',label:'Refresh',icon:RotateCw}]
  :value?.type==='directory'
  ?[{id:'open',label:'Open folder',icon:FolderOpen},{id:'new-file',label:'New file',icon:FilePlus},{id:'new-directory',label:'New folder',icon:FolderPlus},'separator',{id:'rename',label:'Rename',icon:Pencil},{id:'copy',label:'Copy path',icon:Copy},{id:'pin',label:'Pin folder',icon:Pin},{id:'workspace',label:'Add workspace root',icon:FolderTree},...remove]
  :[{id:'open',label:'Open file',icon:ExternalLink},'separator',{id:'rename',label:'Rename',icon:Pencil},{id:'copy',label:'Copy path',icon:Copy},{id:'pin',label:'Pin parent folder',icon:Pin},...remove];
</script>
<ContextMenu {x} {y} items={actions(item)} label="File actions" {onrun} {onclose}/>
