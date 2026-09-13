<script lang="ts">
  import { onMount } from 'svelte';
  import cytoscape from 'cytoscape';
  import { api } from '../lib/api.js';
  import type { GraphLens } from '../lib/graph-model.js';
  import type { WorkbenchState } from '../lib/workbench-state.js';
  import Focus from '@lucide/svelte/icons/focus';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

  export let state: WorkbenchState;
  let host: HTMLDivElement; let cy: cytoscape.Core | undefined; let lens: GraphLens = 'code';
  let error = ''; let count = ''; let budget=90; let root=''; let selected='Architecture overview';
  let generation=0; let contextId=state.snapshot().contextId; let indexId='';
  let layers=new Set(['contains','depends_on','imports','calls','handles','requests','emits','subscribes','queries','flows_to','runtime_in','loads','served_by','coverage','deployment']);
  const layerOptions=[['contains','Containment'],['depends_on','Dependencies'],['imports','Imports'],['calls','Calls'],['handles','HTTP'],['emits','Events'],['queries','SQL'],['flows_to','Declared flows'],['runtime_in','Runtime'],['loads','Loads'],['served_by','Ports'],['coverage','Coverage']];
  const colors: Record<string,string> = { profile:'#d3fa72',device:'#62d9cc',repository:'#d3fa72',package:'#bda4ff',module:'#62d9cc',function:'#78a7ff',external:'#8996a5',endpoint:'#48b9ff',event:'#e68bd4',table:'#f3ad5d',flow:'#f6d365',process:'#ff7d78',service:'#ff9e78',container:'#f3ad5d',port:'#f3ad5d',cycle:'#e68bd4',aggregate:'#717985' };

  function toggleLayer(name:string){layers.has(name)?layers.delete(name):layers.add(name);layers=new Set(layers);void load();}
  async function load() {
    const token=++generation; error='';
    try {
      const query=new URLSearchParams({lens,budget:String(budget),layers:[...layers].join(','),contextId});
      if(root)query.set('root',root);if(indexId)query.set('indexId',indexId);
      const graph = await api<any>(`/api/graph?${query}`); if(token!==generation)return; indexId=graph.index.id.startsWith('runtime:')?'':graph.index.id;
      count = graph.nodes.length?`${graph.nodes.length} nodes · ${graph.edges.length} links`:'No evidence in this lens';if(graph.errors?.length)error=graph.errors.map((item:any)=>item.message).join(' · ');
      cy?.destroy(); cy = cytoscape({ container: host, elements: [...graph.nodes.map((n:any)=>({data:{...n,label:n.label??n.name??n.id}})),...graph.edges.map((e:any)=>({data:e}))], style:[
        {selector:'node',style:{'background-color':(n:any)=>colors[n.data('type')]??'#6d7684','label':'data(label)','font-size':11,'color':'#dce5ef','text-valign':'bottom','text-margin-y':7,'width':(n:any)=>['repository','package','cycle'].includes(n.data('type'))?30:22,'height':(n:any)=>['repository','package','cycle'].includes(n.data('type'))?30:22,'text-outline-color':'#0d1218','text-outline-width':2,'text-wrap':'ellipsis','text-max-width':110} as any},
        {selector:'edge',style:{'line-color':(e:any)=>e.data('type')==='contains'?'#344252':e.data('type')==='calls'?'#78a7ff':e.data('type')==='imports'?'#62d9cc':'#596675','target-arrow-color':(e:any)=>e.data('type')==='imports'?'#62d9cc':'#596675','target-arrow-shape':'triangle','curve-style':'bezier','width':1} as any},
        {selector:':selected',style:{'border-width':2,'border-color':'#ffffff'}}], layout:(lens==='code'&&!root?{name:'grid',padding:42,avoidOverlap:true,condense:false}:{name:'breadthfirst',directed:true,padding:36,spacingFactor:1.45,animate:false}) as any });
      cy.on('tap','node',event=>{const data=event.target.data();if(data.type==='aggregate'){budget+=90;void load();return;}selected=data.label??data.name??data.id;state.select({id:data.id,type:data.type,contextId:data.contextId??graph.index.contextId,path:data.path,line:data.line,label:selected});});
      cy.on('dbltap','node',event=>{const data=event.target.data();if(['repository','package','module','function'].includes(data.type)){root=data.id;lens=data.type==='function'?'function':'code';void load();return;}if(data.path){const filePath=String(data.path).startsWith('/')?data.path:`${graph.index.root}/${data.path}`.replaceAll('//','/');window.dispatchEvent(new CustomEvent('atlas:open-file',{detail:{contextId:data.contextId??graph.index.contextId,path:filePath,pinned:true,line:data.line}}));}});
    } catch (value) { error = (value as Error).message; count='Graph unavailable'; }
  }
  onMount(()=>{void load();const refresh=()=>void load(),unsubscribe=state.subscribe(value=>{if(value.contextId!==contextId){contextId=value.contextId;root='';indexId='';void load();}});window.addEventListener('atlas:graph-refresh',refresh);return ()=>{generation++;unsubscribe();window.removeEventListener('atlas:graph-refresh',refresh);cy?.destroy();}; });
</script>

<section class="panel graph-panel">
  <header><div><strong>Architecture</strong><span>{selected} · {count}</span></div><div class="graph-actions"><button title="Focus selected node" aria-label="Focus selected node" onclick={()=>{root=state.snapshot().selection?.id??'';void load();}}><Focus size={14}/></button><button title="Show overview" aria-label="Show overview" onclick={()=>{root='';void load();}}><RotateCcw size={14}/></button><button title="Fit graph" aria-label="Fit graph" onclick={()=>cy?.fit(undefined,36)}><Maximize2 size={14}/></button><select bind:value={lens} onchange={()=>{root='';void load();}} aria-label="Graph lens"><option value="world">World</option><option value="machine">Machine</option><option value="code">Code</option><option value="function">Function</option><option value="execution">Execution</option></select></div></header>
  <div class="graph-layers" aria-label="Relationship layers">{#each layerOptions as option}<button class:active={layers.has(option[0])} title={`Toggle ${option[1]}`} onclick={()=>toggleLayer(option[0])}>{option[1]}</button>{/each}</div>
  {#if error}<div class="panel-error">{error}</div>{/if}<div class="graph" bind:this={host}></div>
  <div class="graph-legend">{#each Object.entries(colors).filter(([name])=>name!=='aggregate') as [name,color]}<span><i style={`--node-color:${color}`}></i>{name}</span>{/each}</div>
</section>
