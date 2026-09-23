<script lang="ts">
  import SpecialistSections from './SpecialistSections.svelte';
  export let projection: any;
  export let detail: any;
  export let activeView = 'overview';
  export let onenter: (id: string) => void = () => {};
  export let oninspect: (item: any) => void = () => {};
  const groups = [
    { title: 'Components & capabilities', kinds: ['capability', 'service', 'container'] },
    { title: 'Runtime', kinds: ['process', 'job', 'runtime'] },
    { title: 'Interfaces', kinds: ['interface', 'port', 'socket', 'http-endpoint', 'external-system'] },
    { title: 'Data', kinds: ['data-store', 'database', 'table'] },
    { title: 'Resources', kinds: ['resource'] },
    { title: 'Activity', kinds: ['event', 'operation'] },
    { title: 'Software', kinds: ['repository', 'package', 'module', 'class', 'function', 'test', 'file'] },
  ];
  $: entity = detail?.entity ?? projection?.nodes?.find((item: any) => item.id === projection?.rootId);
  $: nodes = (projection?.nodes ?? []).filter((item: any) => item.id !== entity?.id);
</script>

<main class="workload-interior">
  <header class="workload-purpose">
    <div><small>RESOLVED WORKLOAD · {activeView}</small><h2>{entity?.label ?? projection?.synthesis?.headline}</h2><p>{entity?.attributes?.purpose ?? entity?.attributes?.summary ?? 'Atlas resolved this workload from operational evidence.'}</p></div>
    <dl><div><dt>Health</dt><dd>{entity?.attributes?.health ?? 'unknown'}</dd></div><div><dt>Phase</dt><dd>{entity?.attributes?.phase ?? 'unknown'}</dd></div><div><dt>Evidence</dt><dd>{Math.round((entity?.attributes?.confidence ?? 0.5) * 100)}%</dd></div></dl>
  </header>
  <section class="workload-sections" aria-label="Workload interior">
    {#each groups as group}
      {@const items = nodes.filter((item: any) => group.kinds.includes(item.kind))}
      <section class:active-section={items.length > 0}>
        <header><h3>{group.title}</h3><span>{items.length}</span></header>
        <div>{#each items as item (item.id)}<article><button onclick={() => onenter(item.id)}><small>{item.kind}</small><strong>{item.label}</strong></button><button onclick={() => oninspect(item)} aria-label={`Inspect ${item.label}`}>Inspect</button></article>{:else}<p>No {group.title.toLowerCase()} evidence at this depth.</p>{/each}</div>
      </section>
    {/each}
  </section>
  <SpecialistSections descriptors={detail?.views ?? []} {entity} assertions={detail?.assertions ?? []} relatedEntities={detail?.relatedEntities ?? []} {onenter}/>
</main>

<style>
  .workload-interior{min-height:0;flex:1;overflow:auto;padding:12px}.workload-purpose{display:flex;align-items:start;justify-content:space-between;gap:16px;border-bottom:1px solid #26343f;padding:2px 2px 11px}.workload-purpose small{color:#62d9cc;font-size:8px;letter-spacing:.12em}.workload-purpose h2{margin:3px 0;color:#e7f0f6;font-size:19px}.workload-purpose p{max-width:650px;margin:0;color:#8193a1;font-size:10px}.workload-purpose dl{display:flex;gap:5px;margin:0}.workload-purpose dl div{display:grid;min-width:64px;border:1px solid #283943;border-radius:5px;padding:5px 7px}.workload-purpose dt{color:#607483;font-size:7px;text-transform:uppercase}.workload-purpose dd{margin:2px 0 0;color:#cbd9e2;font-size:9px}.workload-sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px;padding-top:7px}.workload-sections>section{min-width:0;border:1px solid #21313c;border-radius:6px;background:#0b141b;padding:7px;opacity:.72}.workload-sections>section.active-section{border-color:#324b5c;opacity:1}.workload-sections header{display:flex;align-items:center;justify-content:space-between}.workload-sections h3{margin:0;color:#b8c8d2;font-size:9px}.workload-sections header span{color:#667b8a;font-size:8px}.workload-sections section>div{display:grid;gap:3px;margin-top:6px}.workload-sections article{display:flex;border-radius:4px;background:#101b23}.workload-sections article>button:first-child{display:grid;min-width:0;flex:1;border:0;background:transparent;padding:6px;text-align:left}.workload-sections article small{color:#627887;font-size:7px}.workload-sections article strong{overflow:hidden;color:#d1dee6;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.workload-sections article>button:last-child{border:0;border-left:1px solid #24343f;background:transparent;color:#607686;font-size:7px}.workload-sections p{margin:8px 0;color:#526775;font-size:8px}@media(max-width:700px){.workload-purpose{display:grid}.workload-purpose dl{overflow:auto}.workload-sections{grid-template-columns:1fr}}
</style>
