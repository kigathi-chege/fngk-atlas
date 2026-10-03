<script lang="ts">import LoadingSpinner from './LoadingSpinner.svelte';export let message:string;export let compact=false;</script>
<div class:compact class="atlas-loading-state" role="status"><LoadingSpinner decorative/><span>{message}</span></div>
<style>.atlas-loading-state{min-height:80px;display:grid;place-content:center;gap:10px;color:var(--atlas-muted);font-size:12px}.atlas-loading-state.compact{min-height:unset;display:flex;align-items:center;gap:7px}</style>
