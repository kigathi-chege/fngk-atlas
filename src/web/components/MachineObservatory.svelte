<script lang="ts">
  import ObservatoryAttention from './ObservatoryAttention.svelte';
  import ObservatoryFlow from './ObservatoryFlow.svelte';
  import ObservatoryRegion from './ObservatoryRegion.svelte';
  import DocumentationHelp from './DocumentationHelp.svelte';
  export let projection: any;
  export let onenter: (id: string) => void = () => {};
  export let oninspect: (item: any) => void = () => {};
  $: model = projection?.observatory;
  $: itemLabels = new Map<string, string>((model?.regions ?? []).flatMap((region: any) => (region.items ?? []).map((item: any) => [item.id, item.label] as [string, string])));
</script>

{#if model}
  <main class:offline={!model.identity.online} class={`machine-observatory health-${model.health}`} aria-label="Machine Observatory">
    <header class="observatory-identity"><DocumentationHelp topicId="observability" label="Observability documentation"/>
      <div>
        <small>{model.identity.online ? 'LIVE DEVICE' : 'LAST OBSERVED DEVICE'}</small>
        <h2>{model.identity.label}</h2>
        <p>{model.summary}</p>
      </div>
      <dl>
        <div><dt>Health</dt><dd class={`health-${model.health}`}>{model.health}</dd></div>
        <div><dt>Activity</dt><dd>{model.phase}</dd></div>
        <div><dt>Observed</dt><dd>{new Date(model.measuredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</dd></div>
      </dl>
    </header>

    <ObservatoryAttention items={model.attention ?? []} {onenter}/>

    <section class="observatory-topology" aria-label="Machine topology">
      {#each model.regions ?? [] as region (region.id)}
        <ObservatoryRegion {region} {onenter} {oninspect}/>
      {/each}
    </section>

    <section class="observatory-supporting">
      <section class="observatory-flows" aria-label="Active flows">
        <header><h3>Activity flow</h3><span>{model.flows?.filter((flow: any) => flow.active).length ?? 0} active</span></header>
        <ul>
          {#each model.flows ?? [] as flow (flow.id)}
            <ObservatoryFlow {flow} labels={itemLabels} {onenter}/>
          {:else}
            <li class="observatory-support-empty">No evidenced flow yet</li>
          {/each}
        </ul>
      </section>
      <section class="observatory-history" aria-label="Recent machine history">
        <header><h3>Recent changes</h3><span>{model.history?.length ?? 0}</span></header>
        <ol>
          {#each model.history ?? [] as item (item.id)}
            <li><button onclick={() => onenter(item.entityId)}>{item.text}</button><time datetime={item.at}>{new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></li>
          {:else}
            <li class="observatory-support-empty">No meaningful changes recorded</li>
          {/each}
        </ol>
      </section>
    </section>
  </main>
{:else}
  <section class="semantic-state">The Device has no Observatory projection yet. Refresh semantic evidence to build one.</section>
{/if}
