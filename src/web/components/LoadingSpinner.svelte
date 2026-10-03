<script lang="ts">
  export let size:'small'|'medium'='small'; export let label='Loading'; export let decorative=false;
</script>
<span class:medium={size==='medium'} class="atlas-loading-spinner" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative}><i></i></span>
<style>
  .atlas-loading-spinner{display:inline-grid;place-items:center;width:14px;height:14px;flex:0 0 auto}.atlas-loading-spinner.medium{width:22px;height:22px}.atlas-loading-spinner i{width:100%;height:100%;border:2px solid color-mix(in srgb,var(--atlas-cyan,#39d6ef) 24%,transparent);border-top-color:var(--atlas-cyan,#39d6ef);border-radius:50%;animation:atlas-spin .75s linear infinite}@keyframes atlas-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.atlas-loading-spinner i{animation-duration:1.8s}}
</style>
