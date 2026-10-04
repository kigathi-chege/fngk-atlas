<script lang="ts">
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import Search from '@lucide/svelte/icons/search';
  import Network from '@lucide/svelte/icons/network';
  import {onMount} from 'svelte';
  import PermanentPanelHeader from './PermanentPanelHeader.svelte';
  import type { WorkbenchState } from '../lib/workbench-state.js';

  export let state: WorkbenchState;
  let snapshot=state.snapshot();onMount(()=>state.subscribe(value=>snapshot=value));
  const dispatch = (name: string) => window.dispatchEvent(new Event(name));
</script>

<section class="workspace-welcome" aria-label="Workspace start">
  <PermanentPanelHeader title="Workspace" subtitle={`${snapshot.connection.profile ?? 'default'} profile`} />
  <div class="workspace-welcome-copy">
    <small>FNGK ATLAS</small>
    <h1>Start working</h1>
    <p>Your open tools stay in this workspace. Choose a context, then open only what you need.</p>
  </div>
  <div class="workspace-actions" aria-label="Workspace actions">
    <button onclick={() => dispatch('atlas:open-terminal')}><SquareTerminal size={16}/><span><b>Open terminal</b><small>Attach to the selected Device</small></span></button>
    <button onclick={() => dispatch('atlas:focus-files')}><FolderOpen size={16}/><span><b>Browse files</b><small>Open the contextual filesystem</small></span></button>
    <button onclick={() => dispatch('atlas:focus-search')}><Search size={16}/><span><b>Search workspace</b><small>Find files, symbols, and commands</small></span></button>
    <button aria-label="Open Device Atlas" onclick={() => dispatch('atlas:open-device-atlas')}><Network size={16}/><span><b>Open Device Atlas</b><small>Inspect the selected Device</small></span></button>
  </div>
  <footer><span>Context</span><b>{snapshot.contextId}</b><span>·</span><span>{snapshot.connection.profile ?? 'default'} profile</span></footer>
</section>
