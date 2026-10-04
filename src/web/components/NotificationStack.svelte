<script lang="ts">
  import {onMount} from 'svelte';
  import {NotificationStore,noticeFromAtlasEvent,type Notice} from '../lib/notifications.js';
  import {atlasEvents} from '../lib/atlas-events.js';
  const store=new NotificationStore();let items:Notice[]=[];let hydrated=false;const seenStates=new Map<string,string>();
  onMount(()=>{const unsubscribe=store.subscribe(value=>items=value),unsubscribeEvents=atlasEvents.subscribe(events=>{for(const event of events){const prior=seenStates.get(event.id);seenStates.set(event.id,event.state);if(!hydrated||prior===event.state)continue;const notice=noticeFromAtlasEvent(event);if(notice)store.push(notice);}hydrated=true}),receive=(event:Event)=>{const item=(event as CustomEvent<Notice>).detail;if(item&&typeof item.message==='string'&&['success','error','info'].includes(item.level))store.push(item)};window.addEventListener('atlas:notice',receive);return()=>{unsubscribe();unsubscribeEvents();store.dispose();window.removeEventListener('atlas:notice',receive)}});
</script>
<aside class="notification-stack" aria-label="Notifications" aria-live="polite" aria-relevant="additions text">{#each items as item(item.id)}<div class:error={item.level==='error'} class="notice"><span>{item.message}</span><button aria-label={`Dismiss ${item.message}`} onclick={()=>store.dismiss(item.id)}>×</button></div>{/each}</aside>
<style>
  .notification-stack{position:fixed;right:16px;bottom:64px;z-index:2500;width:min(360px,calc(100vw - 32px));display:grid;gap:8px;pointer-events:none}.notice{pointer-events:auto;display:flex;gap:12px;align-items:start;padding:12px 14px;background:var(--atlas-surface-2);color:var(--atlas-text);border:1px solid var(--atlas-border);border-left:3px solid var(--atlas-cyan);border-radius:6px;font-size:12px;box-shadow:var(--atlas-shadow-popover)}.notice.error{border-left-color:var(--atlas-danger)}.notice span{flex:1;overflow-wrap:anywhere}.notice button{padding:0 4px;background:transparent;border:0}
</style>
