<script lang="ts">
  export let flow: any;
  export let labels: Map<string, string> = new Map();
  export let onenter: (id: string) => void = () => {};
  const label = (id: string, fallback?: string) => fallback ?? labels.get(id) ?? id;
</script>

<li class:active={flow.active} class:stale={flow.stale} class={`observatory-flow health-${flow.health}`}>
  <button class="flow-summary" onclick={() => onenter(flow.sourceId)}>{label(flow.sourceId, flow.sourceLabel)} → {label(flow.targetId, flow.targetLabel)}</button>
  <small>{flow.label}</small>
  <button class="flow-target" onclick={() => onenter(flow.targetId)} aria-label={`Open ${label(flow.targetId, flow.targetLabel)}`}>↗</button>
</li>
