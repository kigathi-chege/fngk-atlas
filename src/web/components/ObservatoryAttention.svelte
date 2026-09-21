<script lang="ts">
  export let items: any[] = [];
  export let onenter: (id: string) => void = () => {};
</script>

{#if items.length}
  <section class="observatory-attention" aria-label="Attention required">
    <header><h3>Needs attention</h3><span>{items.length}</span></header>
    <div>
      {#each items as item (item.id)}
        <button class:critical={item.severity === 'critical'} class:stale={item.stale} onclick={() => item.entityIds?.[0] && onenter(item.entityIds[0])}>
          <strong>{item.severity}</strong><span>{item.text}</span>
        </button>
      {/each}
    </div>
  </section>
{/if}
