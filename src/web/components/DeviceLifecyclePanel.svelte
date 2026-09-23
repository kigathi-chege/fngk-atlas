<script lang="ts">
  import type {WorkbenchState} from '../lib/workbench-state.js';
  export let state:WorkbenchState;
  $: contextId=state.snapshot().contextId;
  $: isDevice=contextId.startsWith('device:');
</script>
<section class="device-lifecycle-panel" aria-label="Device lifecycle"><header><small>DEVICE LIFECYCLE</small><h2>{isDevice?contextId:'Select a Device context'}</h2></header>{#if isDevice}<p>Inspect profile readiness, update state, recovery options, and connection cleanup for this Device.</p><div><button onclick={()=>window.dispatchEvent(new CustomEvent('atlas:open-fngk-handoff',{detail:{contextId}}))}>Update FNGK</button><button onclick={()=>window.dispatchEvent(new CustomEvent('atlas:open-ports',{detail:{contextId}}))}>Published ports</button></div><small>Profile discovery and destructive actions are enabled when Device control-plane readiness is available.</small>{:else}<p>Choose a Device from the left rail, then open this panel again.</p>{/if}</section>
<style>.device-lifecycle-panel{height:100%;box-sizing:border-box;padding:18px;display:grid;align-content:start;gap:12px;background:var(--atlas-bg,#080b0f)}header small{color:var(--atlas-accent,#62d9cc);font-size:9px;letter-spacing:.14em}h2{margin:4px 0 0;font-size:15px}p,section>small{margin:0;color:var(--atlas-muted,#91a2b2);font-size:11px;line-height:1.5}section>div{display:flex;gap:7px}button{padding:7px 10px}</style>
