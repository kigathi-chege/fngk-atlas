<script lang="ts">
  export let region: any;
  export let onenter: (id: string) => void = () => {};
  export let oninspect: (item: any) => void = () => {};
</script>

<section
  class:degraded={region.health === 'degraded'}
  class:critical={region.health === 'critical'}
  class:stale={region.health === 'stale'}
  class="observatory-region"
  data-observatory-region={region.id}
  aria-labelledby={`observatory-region-${region.id}`}
>
  <header>
    <h3 id={`observatory-region-${region.id}`}>{region.label}</h3>
    <span class={`health health-${region.health}`}>{region.health}</span>
  </header>
  <div class="observatory-region-items">
    {#each region.items ?? [] as item (item.id)}
      <article class:active={item.active} class:stale={item.stale} class={`observatory-item health-${item.health}`}>
        <button class="observatory-enter" onclick={() => onenter(item.id)} aria-label={`${item.label}, ${item.health}, ${item.phase}`}>
          <span class="activity-mark" aria-hidden="true"></span>
          <span>
            <strong>{item.label}</strong>
            <small>{item.purpose}</small>
          </span>
          <em>{item.phase}</em>
        </button>
        <button class="observatory-inspect" onclick={() => oninspect(item)} aria-label={`Inspect ${item.label}`}>Inspect</button>
      </article>
    {/each}
    {#if !(region.items?.length)}
      <p class="observatory-region-empty">No resolved activity</p>
    {/if}
  </div>
  {#if region.collapsedCount}
    <p class="observatory-collapsed">
      {region.collapsedCount} inactive {region.id === 'system' ? 'system services' : `${region.label.toLowerCase()} items`}
    </p>
  {/if}
</section>
