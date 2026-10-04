<script lang="ts">
  export let title:string;
  export let subtitle='';
</script>

<header class="atlas-permanent-header">
  <div class="atlas-permanent-heading"><strong>{title}</strong>{#if subtitle}<small>{subtitle}</small>{/if}</div>
  <div class="atlas-permanent-actions"><slot/></div>
</header>

<style>
  .atlas-permanent-header{display:flex;align-items:center;gap:8px;min-height:36px;padding:0 10px;border-bottom:1px solid var(--atlas-border);background:var(--atlas-surface)}
  .atlas-permanent-heading{display:grid;gap:1px;min-width:0;margin-right:auto}.atlas-permanent-heading strong{font-size:11px;letter-spacing:.02em}.atlas-permanent-heading small{overflow:hidden;color:var(--atlas-muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.atlas-permanent-actions{display:flex;align-items:center;gap:4px}
</style>
