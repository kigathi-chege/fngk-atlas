<script lang="ts">
  import CircleHelp from '@lucide/svelte/icons/circle-help';
  import type {DocumentationTopicId} from '../lib/documentation.js';
  export let topicId:DocumentationTopicId;export let label='Open related documentation';
  const open=()=>window.dispatchEvent(new CustomEvent('atlas:open-documentation',{detail:{topicId}}));
</script>
<button class="documentation-help" title={label} aria-label={label} onclick={open}><CircleHelp size={14}/><span>Help</span></button>
<style>.documentation-help{display:inline-flex;align-items:center;gap:4px}.documentation-help span{font-size:11px}</style>
