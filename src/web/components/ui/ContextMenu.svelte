<script lang="ts" module>
  import type {Snippet} from 'svelte';
  import type {MenuEntry,MenuItem} from '../../lib/menu.js';
  // One menu at a time: opening a menu closes any other that is open.
  const opened='atlas:menu-opened';
</script>
<script lang="ts">
  import {onMount} from 'svelte';
  let {x=0,y=0,items=[],label='Actions',header,onrun=()=>{},onclose=()=>{}}:{x?:number;y?:number;items?:MenuEntry[];label?:string;header?:Snippet;onrun?:(id:string)=>void;onclose?:()=>void}=$props();
  let menu:HTMLDivElement;let left=$state(0),top=$state(0);
  const token={};
  // Drop leading, trailing and doubled separators so callers can join groups freely.
  const entries=$derived(items.filter((entry,index)=>entry!=='separator'||(index>0&&index<items.length-1&&items[index-1]!=='separator')));
  const enabled=()=>[...menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')];
  function place(){if(!menu)return;const box=menu.getBoundingClientRect();left=Math.max(4,Math.min(x,innerWidth-box.width-4));top=Math.max(4,Math.min(y,innerHeight-box.height-4))}
  function run(item:MenuItem){if(item.disabled)return;onrun(item.id);onclose()}
  function keydown(event:KeyboardEvent){
    if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();onclose();return}
    const list=enabled(),at=list.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==='ArrowDown'?at+1:event.key==='ArrowUp'?(at<0?list.length-1:at-1):event.key==='Home'?0:event.key==='End'?list.length-1:undefined;
    if(next===undefined||!list.length)return;event.preventDefault();list[(next+list.length)%list.length].focus();
  }
  $effect(()=>{x;y;entries.length;place()});
  onMount(()=>{
    // Render at the shell, outside panels that clip or transform, but inside the theme.
    (document.querySelector('.atlas-shell')??document.body).appendChild(menu);
    place();menu.focus({preventScroll:true});
    window.dispatchEvent(new CustomEvent(opened,{detail:token}));
    const other=(event:Event)=>{if((event as CustomEvent).detail!==token)onclose()};
    const outside=(event:PointerEvent)=>{const target=event.target as Element|null;if(!menu.contains(target)&&!target?.closest?.('[data-menu-trigger]'))onclose()};
    const dismiss=()=>onclose();
    window.addEventListener(opened,other);document.addEventListener('pointerdown',outside,true);window.addEventListener('blur',dismiss);window.addEventListener('resize',dismiss);
    return()=>{window.removeEventListener(opened,other);document.removeEventListener('pointerdown',outside,true);window.removeEventListener('blur',dismiss);window.removeEventListener('resize',dismiss);menu.remove()};
  });
</script>
<div bind:this={menu} class="atlas-popup atlas-popup-floating" role="menu" aria-label={label} tabindex="-1" style={`left:${left}px;top:${top}px`} onkeydown={keydown} oncontextmenu={(event)=>event.preventDefault()}>
  {#if header}<div class="atlas-popup-header">{@render header()}</div><div role="separator"></div>{/if}
  {#each entries as entry}
    {#if entry==='separator'}<div role="separator"></div>
    {:else}{@const Icon=entry.icon}<button type="button" role="menuitem" class:danger={entry.danger} disabled={entry.disabled} onclick={()=>run(entry)}>{#if Icon}<Icon size={14}/>{:else}<i class="atlas-popup-blank"></i>{/if}<span>{entry.label}</span>{#if entry.hint}<kbd>{entry.hint}</kbd>{/if}</button>{/if}
  {/each}
</div>
