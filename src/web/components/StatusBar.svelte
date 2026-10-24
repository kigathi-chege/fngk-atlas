<script lang="ts">
  import {onMount} from 'svelte';
  import PanelBottomOpen from '@lucide/svelte/icons/panel-bottom-open';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import ScrollText from '@lucide/svelte/icons/scroll-text';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleX from '@lucide/svelte/icons/circle-x';
  import Ban from '@lucide/svelte/icons/ban';
  import Gauge from '@lucide/svelte/icons/gauge';
  import Activity from '@lucide/svelte/icons/activity';
  import Copy from '@lucide/svelte/icons/copy';
  import X from '@lucide/svelte/icons/x';
  import DeviceChip from './DeviceChip.svelte';
  import {atlasEvents,type AtlasEvent} from '../lib/atlas-events.js';
  import {eventDurationMs,eventReport,formatDuration,summarize} from '../lib/status-activity.js';
  import type {WorkbenchSnapshot,WorkbenchState} from '../lib/workbench-state.js';

  let {workbench,snapshot}:{workbench:WorkbenchState;snapshot:WorkbenchSnapshot}=$props();
  const seenKey='atlas.status-seen.v1';
  // The first time the bar runs, history from before it existed counts as seen, not as a flood of new errors.
  const readSeen=()=>{try{const stored=Number(localStorage.getItem(seenKey));if(stored)return stored;const now=Date.now();localStorage.setItem(seenKey,String(now));return now}catch{return Date.now()}};
  let events=$state<AtlasEvent[]>([]),seenAt=$state(readSeen()),now=$state(Date.now()),open=$state(false),filter=$state<'all'|'errors'|'running'>('all'),expanded=$state(''),copied=$state('');
  let drawer=$state<HTMLElement>(),toggle=$state<HTMLElement>();
  const summary=$derived(summarize(events,{contextId:snapshot.contextId,seenAt}));
  const shown=$derived([...events].sort((a,b)=>Date.parse(b.updatedAt??b.createdAt)-Date.parse(a.updatedAt??a.createdAt)).filter(event=>filter==='all'||(filter==='errors'?event.state==='error'||event.state==='warning':event.state==='pending')).slice(0,50));
  const connected=$derived(snapshot.connection.phase==='connected');
  const icons={pending:LoaderCircle,success:CircleCheck,warning:TriangleAlert,error:CircleX,cancelled:Ban};
  const ago=(event:AtlasEvent)=>{const seconds=Math.max(0,Math.round((now-Date.parse(event.updatedAt??event.createdAt))/1000));return seconds<60?`${seconds}s ago`:seconds<3600?`${Math.floor(seconds/60)}m ago`:new Date(event.updatedAt??event.createdAt).toLocaleTimeString()};
  const emit=(name:string)=>window.dispatchEvent(new Event(name));

  // Opening the drawer marks every error so far as seen; the badge counts only newer ones.
  function show(next:'all'|'errors'|'running'='all'){filter=next;open=true;seenAt=Date.now();try{localStorage.setItem(seenKey,String(seenAt))}catch{}}
  function close(){open=false;expanded=''}
  async function copy(event:AtlasEvent){try{await navigator.clipboard.writeText(eventReport(event));copied=event.id;setTimeout(()=>{if(copied===event.id)copied=''},1500)}catch{}}

  onMount(()=>{
    const unsubscribe=atlasEvents.subscribe(items=>events=items);
    // Tick only while something runs or the drawer is open, so elapsed times stay live without idle work.
    const timer=setInterval(()=>{if(open||summary.running.length)now=Date.now()},1000);
    const outside=(event:PointerEvent)=>{const target=event.target as Node;if(open&&!drawer?.contains(target)&&!toggle?.contains(target))close()};
    const key=(event:KeyboardEvent)=>{if(open&&event.key==='Escape')close()};
    const showEvents=()=>show();
    document.addEventListener('pointerdown',outside,true);window.addEventListener('keydown',key);window.addEventListener('atlas:show-events',showEvents);
    return()=>{unsubscribe();clearInterval(timer);document.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',key);window.removeEventListener('atlas:show-events',showEvents)};
  });
</script>

<footer class="status-bar" aria-label="Status">
  <button class="status-connection" class:ok={connected} title={snapshot.connection.message} aria-label="Connection setup and recovery" onclick={()=>emit('atlas:recover')}><span aria-hidden="true">◆</span><b>{connected?'FNGK connected':snapshot.connection.phase==='checking'?'Checking FNGK…':'FNGK disconnected'}</b></button>
  <DeviceChip contextId={snapshot.contextId} compact/>
  {#if summary.roundTripMs!==undefined}<span class="status-roundtrip" class:slow={summary.roundTripMs>=3000} title="Typical time for a file request to reach this Device and come back"><Gauge size={12}/>~{formatDuration(summary.roundTripMs)}</span>{/if}

  <button class="status-activity" class:failed={!summary.running.length&&summary.unseenErrors.length>0} title="Show recent events" onclick={()=>show(summary.running.length?'running':summary.unseenErrors.length?'errors':'all')}>
    {#if summary.running.length}{@const current=summary.running[0]}<LoaderCircle size={12} class="spin"/><span class="status-text">{current.title}</span><em>{formatDuration(eventDurationMs(current,now))}</em>{#if summary.running.length>1}<em>+{summary.running.length-1}</em>{/if}
    {:else if summary.unseenErrors.length}{@const failure=summary.unseenErrors[0]}<TriangleAlert size={12}/><span class="status-text">{failure.title}{#if failure.message} · {failure.message}{/if}</span>
    {:else if summary.latest}{@const Icon=icons[summary.latest.state]}<Icon size={12}/><span class="status-text muted">{summary.latest.title}{#if summary.latest.message} · {summary.latest.message}{/if}</span><em class="muted">{formatDuration(eventDurationMs(summary.latest,now))}</em>
    {:else}<span class="status-text muted">{snapshot.connection.message}</span>{/if}
  </button>

  <span class="status-tools">
    <button bind:this={toggle} class="status-events" class:has-errors={summary.unseenErrors.length>0} title="Recent events" aria-label={summary.unseenErrors.length?`Recent events, ${summary.unseenErrors.length} new errors`:'Recent events'} aria-expanded={open} onclick={()=>open?close():show(summary.unseenErrors.length?'errors':'all')}><Activity size={13}/>{#if summary.unseenErrors.length}<i>{summary.unseenErrors.length}</i>{/if}</button>
    <button title="Open terminal" aria-label="Open terminal" onclick={()=>emit('atlas:open-terminal')}><SquareTerminal size={13}/></button>
    <button title="Open logs (Observability)" aria-label="Open logs" onclick={()=>emit('atlas:open-observability')}><ScrollText size={13}/></button>
    <button title="Open operations dock" aria-label="Open operations dock" onclick={()=>emit('atlas:open-operations')}><PanelBottomOpen size={13}/></button>
    <button class="status-text-button" title="Connection setup and recovery" onclick={()=>emit('atlas:recover')}>Recovery</button>
    <button title="Previous selection" onclick={()=>workbench.back()}>←</button><button title="Next selection" onclick={()=>workbench.forward()}>→</button>
  </span>
</footer>

{#if open}
  <section bind:this={drawer} class="status-drawer" aria-label="Recent events">
    <header>
      <strong>Events</strong>
      <div class="status-filters" role="tablist" aria-label="Filter events">{#each [['all','All'],['errors','Problems'],['running','Running']] as [id,label]}<button role="tab" aria-selected={filter===id} onclick={()=>filter=id as typeof filter}>{label}</button>{/each}</div>
      <button class="status-text-button" title="Open the full history" onclick={()=>{close();emit('atlas:open-observability')}}>Full history</button>
      <button title="Close events" aria-label="Close events" onclick={close}><X size={13}/></button>
    </header>
    <ol>
      {#each shown as event (event.id)}{@const Icon=icons[event.state]}
        <li class={event.state} class:open={expanded===event.id}>
          <button class="status-event" aria-expanded={expanded===event.id} onclick={()=>expanded=expanded===event.id?'':event.id}>
            <Icon size={13} class={event.state==='pending'?'spin':''}/>
            <span class="status-event-main"><b>{event.title}</b>{#if event.message}<small>{event.message}</small>{/if}</span>
            <span class="status-event-meta"><em>{formatDuration(eventDurationMs(event,now))}</em><time datetime={event.updatedAt??event.createdAt}>{ago(event)}</time></span>
          </button>
          {#if expanded===event.id}
            <div class="status-event-details">
              <dl><div><dt>Type</dt><dd>{event.type}</dd></div>{#if event.contextId}<div><dt>Where</dt><dd><DeviceChip contextId={event.contextId} compact/></dd></div>{/if}<div><dt>Started</dt><dd>{new Date(event.createdAt).toLocaleTimeString()}</dd></div>{#each Object.entries(event.metadata??{}) as [key,value]}<div><dt>{key}</dt><dd>{String(value)}</dd></div>{/each}</dl>
              <button class="status-text-button" onclick={()=>copy(event)}><Copy size={12}/>{copied===event.id?'Copied':'Copy details'}</button>
            </div>
          {/if}
        </li>
      {:else}<li class="status-empty">{filter==='errors'?'No problems recorded.':filter==='running'?'Nothing is running.':'No events yet.'}</li>{/each}
    </ol>
  </section>
{/if}
