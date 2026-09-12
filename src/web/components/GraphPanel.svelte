<script lang="ts">
  import { onMount } from 'svelte';
  import cytoscape from 'cytoscape';
  import { api } from '../lib/api.js';
  import type { GraphLens } from '../lib/graph-model.js';
  import type { WorkbenchState } from '../lib/workbench-state.js';
  export let state: WorkbenchState;
  let host: HTMLDivElement; let cy: cytoscape.Core | undefined; let lens: GraphLens = 'code'; let error = ''; let count = '';let budget=90;let root='';let selected='Nothing selected';let generation=0;let contextId=state.snapshot().contextId;const layers=new Set(['contains','imports','calls','runtime_in','loads','served_by','coverage','deployment']);
  const colors: Record<string,string> = { repository:'#d3fa72',package:'#bda4ff',module:'#62d9cc',function:'#78a7ff',process:'#ff7d78',port:'#f3ad5d',cycle:'#e68bd4',aggregate:'#717985' };
  async function load() {
    const token=++generation;try { const query=new URLSearchParams({lens,budget:String(budget),layers:[...layers].join(','),contextId});if(root)query.set('root',root);const graph = await api<any>(`/api/graph?${query}`);if(token!==generation)return; count = graph.nodes.length?`${graph.nodes.length} nodes · ${graph.edges.length} links`:'No evidence in this lens';
      cy?.destroy(); cy = cytoscape({ container: host, elements: [...graph.nodes.map((n:any)=>({data:{...n,label:n.label??n.name??n.id}})),...graph.edges.map((e:any)=>({data:e}))], style:[
        {selector:'node',style:{'background-color':(n:any)=>colors[n.data('type')]??'#6d7684','label':'data(label)','font-size':11,'color':'#dce5ef','text-valign':'bottom','text-margin-y':7,'width':18,'height':18}},
        {selector:'edge',style:{'line-color':'#3b4654','target-arrow-color':'#3b4654','target-arrow-shape':'triangle','curve-style':'bezier','width':1}},
        {selector:':selected',style:{'border-width':2,'border-color':'#ffffff'}}], layout:{name:'breadthfirst',directed:true,padding:28,spacingFactor:1.25,animate:false} as any });
      cy.on('tap','node',event=>{const data=event.target.data();if(data.type==='aggregate'){budget+=90;void load();return;}selected=data.label??data.name??data.id;state.select({id:data.id,type:data.type,contextId:data.contextId??graph.index.contextId,path:data.path,line:data.line,label:data.label??data.name});});cy.on('dbltap','node',event=>{const data=event.target.data();if(data.path){const sourcePath=String(data.path),filePath=sourcePath.startsWith('/')?sourcePath:`${graph.index.root}/${sourcePath}`.replaceAll('//','/');window.dispatchEvent(new CustomEvent('atlas:open-file',{detail:{contextId:data.contextId??graph.index.contextId??'local',path:filePath,pinned:true,line:data.line}}));}});
    } catch (value) { error = (value as Error).message; }
  }
  onMount(()=>{void load();const refresh=()=>void load(),unsubscribe=state.subscribe(value=>{if(value.contextId!==contextId){contextId=value.contextId;root='';void load();}});window.addEventListener('atlas:graph-refresh',refresh);return ()=>{generation++;unsubscribe();window.removeEventListener('atlas:graph-refresh',refresh);cy?.destroy();}; });
</script>
<section class="panel graph-panel"><header><div><button onclick={()=>state.back()}>←</button><button onclick={()=>state.forward()}>→</button><strong>Semantic map</strong><span>{selected} · {count}</span></div><div><button onclick={()=>{root=state.snapshot().selection?.id??'';void load();}}>Focus</button><button onclick={()=>{root='';void load();}}>All</button><button onclick={()=>cy?.fit(undefined,28)}>Fit</button><select bind:value={lens} onchange={load} aria-label="Graph lens"><option value="world">World</option><option value="machine">Machine</option><option value="code">Code</option><option value="function">Function</option><option value="execution">Execution</option></select></div></header>{#if error}<div class="panel-error">{error}</div>{/if}<div class="graph" bind:this={host}></div></section>
