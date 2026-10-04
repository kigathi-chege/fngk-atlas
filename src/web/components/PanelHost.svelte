<script lang="ts">
  import {onMount} from 'svelte';import type {Readable} from 'svelte/store';import type {WorkbenchState} from '../lib/workbench-state.js';import WorkspacePanel from './WorkspacePanel.svelte';import LoadingState from './LoadingState.svelte';
  export let kind='atlas';export let paramsStore:Readable<Record<string,unknown>>;export let state:WorkbenchState;
  let params:Record<string,unknown>={},ready=false,Component:any,loadError='';
  const loaders:Record<string,()=>Promise<any>>={atlas:()=>import('./SemanticAtlas.svelte'),navigator:()=>import('./Navigator.svelte'),'device-details':()=>import('./DeviceDetailsPanel.svelte'),filesystem:()=>import('./FilesystemTree.svelte'),file:()=>import('./FilePanel.svelte'),terminal:()=>import('./TerminalPanel.svelte'),database:()=>import('./DatabasePanel.svelte'),'live-project':()=>import('./LiveProjectPanel.svelte'),deployment:()=>import('./DeploymentPanel.svelte'),'port-sharing':()=>import('./PortSharingPanel.svelte'),'fngk-handoff':()=>import('./FngkHeadHandoffPanel.svelte'),'device-lifecycle':()=>import('./DeviceLifecyclePanel.svelte'),'device-sessions':()=>import('./DeviceSessionsPanel.svelte'),'agent-chat':()=>import('./AgentChatPanel.svelte'),'app-connections':()=>import('./AppConnectionsPanel.svelte'),documentation:()=>import('./DocumentationPanel.svelte'),logs:()=>import('./LogsPanel.svelte'),intelligence:()=>import('./IntelligencePanel.svelte'),details:()=>import('./DetailsPanel.svelte'),metrics:()=>import('./MetricsPanel.svelte'),output:()=>import('./OutputPanel.svelte')};
  onMount(()=>{const unsubscribe=paramsStore.subscribe(value=>{params=value;ready=true}),loader=loaders[kind];if(loader)void loader().then(value=>Component=value.default).catch(error=>loadError=(error as Error).message);return unsubscribe});
</script>
{#if ready}
  {#if kind==='workspace'}<WorkspacePanel {state}/>
  {:else if kind==='operations'}<section class="operations-placeholder" aria-label="Empty operations dock"></section>
  {:else if loadError}<div class="panel-error">{loadError}</div>
  {:else if Component}
    {#if kind==='atlas'||kind==='navigator'||kind==='device-details'||kind==='filesystem'||kind==='intelligence'||kind==='details'||kind==='metrics'||kind==='output'}<Component {state}/>
    {:else if kind==='terminal'||kind==='database'||kind==='live-project'||kind==='deployment'||kind==='port-sharing'||kind==='fngk-handoff'||kind==='device-lifecycle'||kind==='documentation'}<Component {params} {state}/>
    {:else if kind==='device-sessions'||kind==='agent-chat'}<Component {state}/>
    {:else if kind==='app-connections'}<Component/>
    {:else if kind==='file'}{#key `${params.contextId}:${params.path??params.bufferId}`}<Component {params}/>{/key}
    {:else if kind==='logs'}<Component {params}/>{/if}
  {:else}<LoadingState message="Loading panel…"/>{/if}
{/if}
