<script lang="ts">
  import {onMount} from 'svelte';
  import type {AtlasBuffer} from '../lib/buffer-store.js';
  import type {WorkspaceRoot} from '../lib/workspace-roots.js';

  export let buffer:AtlasBuffer;
  export let roots:WorkspaceRoot[]=[];
  export let oncancel:()=>void=()=>{};
  export let onsave:(path:string)=>void=()=>{};

  let directory=buffer.suggestedDirectory??roots[0]?.path??'';
  let filename=buffer.proposedPath?.split('/').filter(Boolean).at(-1)??(buffer.name.startsWith('Untitled-')?'':buffer.name);
  let error='';
  let directoryInput:HTMLInputElement;

  function submit(){
    const name=filename.trim();
    if(!directory.startsWith('/')){error='Choose an absolute directory.';return}
    if(!name||name==='.'||name==='..'||name.includes('/')||name.includes('\0')){error='Enter a valid filename without slashes.';return}
    onsave(`${directory==='/'?'':directory.replace(/\/+$/,'')}/${name}`);
  }

  onMount(()=>directoryInput.focus());
</script>

<div class="atlas-dialog-backdrop">
  <div class="atlas-dialog save-as-dialog" role="dialog" aria-modal="true" aria-labelledby="save-as-title">
    <form onsubmit={(event)=>{event.preventDefault();submit()}}>
      <h2 id="save-as-title">Save {buffer.name} as</h2>
      {#if roots.length}
        <div class="save-root-options">
          {#each roots as root}<button type="button" onclick={()=>directory=root.path}>{root.kind==='workspace'?'Workspace':'Pinned'} · {root.path}</button>{/each}
        </div>
      {/if}
      <label>Directory<input bind:this={directoryInput} bind:value={directory} aria-label="Save directory" placeholder="/path/to/folder"/></label>
      <label>Filename<input bind:value={filename} aria-label="Save filename" placeholder="example.ts"/></label>
      {#if error}<p class="panel-error">{error}</p>{/if}
      <p>First save creates a new file exclusively. Existing files are never overwritten.</p>
      <div class="dialog-actions"><button type="button" onclick={oncancel}>Cancel</button><button type="submit">Create file</button></div>
    </form>
  </div>
</div>
