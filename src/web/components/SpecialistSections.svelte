<script lang="ts">
  export let descriptors: any[] = [];
  export let entity: any;
  export let assertions: any[] = [];
  export let relatedEntities: any[] = [];
  export let onenter: (id: string) => void = () => {};
  const primitive = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
  const fields = (section: any) => Object.entries(entity?.attributes ?? {}).filter(([key, value]) => primitive(value) && (!section.fields?.length || section.fields.includes(key))).slice(0, 24);
  const relationships = (section: any) => assertions.filter((item) => !section.predicate || item.predicate === section.predicate).slice(0, 24);
  const related = (id?: string) => relatedEntities.find((item) => item.id === id);
</script>

{#each descriptors as descriptor (descriptor.id)}
  <section class="specialist-view" aria-label={descriptor.title}>
    <header><h3>{descriptor.title}</h3><span>Interpreter view</span></header>
    {#each descriptor.sections ?? [] as section}
      <section class="specialist-section">
        <h4>{section.title ?? section.kind}</h4>
        {#if ['properties', 'metrics', 'documentation', 'table'].includes(section.kind)}
          <dl>{#each fields(section) as [key, value]}<div><dt>{key}</dt><dd>{String(value)}</dd></div>{:else}<p>{section.empty ?? 'No matching evidence.'}</p>{/each}</dl>
        {:else if ['relationships', 'hierarchy'].includes(section.kind)}
          <div class="specialist-relations">{#each relationships(section) as assertion}{@const target = related(assertion.objectId) ?? related(assertion.subjectId)}<button disabled={!target} onclick={() => target && onenter(target.id)}><b>{assertion.predicate.replaceAll('-', ' ')}</b><span>{target?.label ?? String(assertion.value ?? 'evidence')}</span></button>{:else}<p>{section.empty ?? 'No matching relationships.'}</p>{/each}</div>
        {:else if section.kind === 'evidence'}
          <ul>{#each relationships(section) as assertion}<li><b>{assertion.predicate.replaceAll('-', ' ')}</b><span>{assertion.explanation}</span><small>{Math.round(assertion.confidence * 100)}% · {assertion.classification}</small></li>{:else}<li>{section.empty ?? 'No supporting assertions.'}</li>{/each}</ul>
        {:else}
          <p>{section.empty ?? 'No retained information for this section.'}</p>
        {/if}
      </section>
    {/each}
  </section>
{/each}

<style>
  .specialist-view{margin-top:7px;border:1px solid #304654;border-radius:7px;background:#0b151c;padding:8px}.specialist-view>header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #22323d;padding-bottom:6px}.specialist-view h3{margin:0;color:#c9d7df;font-size:10px}.specialist-view>header span{color:#62d9cc;font-size:7px;text-transform:uppercase}.specialist-section{padding:8px 2px 2px}.specialist-section h4{margin:0 0 5px;color:#8195a3;font-size:8px;text-transform:uppercase}.specialist-section dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px;margin:0}.specialist-section dl div{display:grid;border-radius:4px;background:#101c24;padding:5px}.specialist-section dt{color:#657987;font-size:7px}.specialist-section dd{overflow:hidden;margin:2px 0 0;color:#c1d0d9;font-size:9px;text-overflow:ellipsis}.specialist-section p{margin:4px 0;color:#607482;font-size:8px}.specialist-relations{display:grid;gap:3px}.specialist-relations button{display:flex;justify-content:space-between;border:0;border-radius:4px;background:#101c24;padding:6px;color:#9bafbc;font-size:8px}.specialist-section ul{display:grid;gap:3px;margin:0;padding:0;list-style:none}.specialist-section li{display:grid;border-radius:4px;background:#101c24;padding:6px;font-size:8px}.specialist-section li span{color:#8396a3}.specialist-section li small{color:#607482}
</style>
