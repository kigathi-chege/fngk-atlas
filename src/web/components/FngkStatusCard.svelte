<script lang="ts">
  export let status: any;
  const labels:Record<string,string>={checking:'Checking FNGK',ready:'FNGK ready','install-choice':'Install FNGK','update-choice':'Update FNGK','daemon-install-choice':'Start FNGK daemon','login-choice':'Sign in to FNGK','recoverable-error':'FNGK needs attention'};
</script>

<section class:ready={status?.state==='ready'} class="fngk-status-card" aria-label="FNGK local runtime status">
  <span class="status-dot" aria-hidden="true"></span><div><b>{labels[status?.state]??'Checking FNGK'}</b><small>{status?.local?.message??'Checking the local machine connection.'}</small></div>
  {#if status?.local?.version}<code>{status.local.version}</code>{/if}
</section>

<style>
  .fngk-status-card{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--atlas-border,#283847);border-radius:8px;background:var(--atlas-panel,#111a23);color:var(--atlas-text,#e5edf3);min-width:220px}.status-dot{width:8px;height:8px;border-radius:50%;background:#f3a33b}.ready .status-dot{background:#56c596}.fngk-status-card div{display:grid;gap:2px;min-width:0}.fngk-status-card b{font-size:12px}.fngk-status-card small{font-size:10px;color:var(--atlas-muted,#91a2b2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fngk-status-card code{margin-left:auto;font-size:10px;color:var(--atlas-muted,#91a2b2)}
</style>
