<script lang="ts">
  import { onMount, mount, unmount } from 'svelte';
  import { createDockview, type GroupPanelPartInitParameters, type IContentRenderer, type ITabRenderer, type TabPartInitParameters } from 'dockview';
  import { writable } from 'svelte/store';
  import PanelHost from './PanelHost.svelte';
  import type { WorkbenchState } from '../lib/workbench-state.js';

  export let state: WorkbenchState;
  let host: HTMLDivElement; let pendingClose: { api: any; title: string } | null = null;
  const dirtyPanels = new Set<string>();

  class Renderer implements IContentRenderer {
    element=document.createElement('div'); component:any; params=writable<Record<string,unknown>>({});kind:string;
    constructor(kind:string){this.kind=kind;this.element.className='dock-panel-host';}
    init(parameters:GroupPanelPartInitParameters){this.params.set(parameters.params??{});this.component=mount(PanelHost,{target:this.element,props:{kind:this.kind,paramsStore:this.params,state}});}
    update(event:{params:Record<string,unknown>}){this.params.update(value=>({...value,...event.params}));}
    dispose(){if(this.component)void unmount(this.component);}
  }
  class GuardedFileTab implements ITabRenderer {
    element=document.createElement('div'); title=document.createElement('span'); close=document.createElement('button'); subscription?:{dispose():void}; panelId='';
    constructor(){this.element.className='atlas-file-tab';this.title.className='atlas-file-tab-title';this.close.className='atlas-file-tab-close';this.close.type='button';this.close.textContent='×';this.element.append(this.title,this.close);}
    init(parameters:TabPartInitParameters){this.panelId=parameters.api.id;this.element.dataset.panelId=this.panelId;const update=(title:string)=>{this.title.textContent=title;this.close.setAttribute('aria-label',`Close ${title}`)};update(parameters.title);this.subscription=parameters.api.onDidTitleChange(event=>update(event.title));this.close.onclick=event=>{event.stopPropagation();if(!dirtyPanels.has(this.panelId))parameters.api.close();else window.dispatchEvent(new CustomEvent('atlas:confirm-close',{detail:{api:parameters.api,title:parameters.title}}));};}
    dispose(){this.subscription?.dispose();}
  }

  onMount(()=>{
    const dock=createDockview(host,{createComponent:({name})=>new Renderer(name),createTabComponent:({name})=>name==='guarded-file'?new GuardedFileTab():undefined,getTabContextMenuItems:({panel}:any)=>dirtyPanels.has(panel.id)?[]:['close','closeOthers','closeAll','separator','maximize']});
    const saved=localStorage.getItem('atlas.workbench.v2');let restored=false;
    if(saved)try{const value=JSON.parse(saved);if(value?.version===2&&value.layout){dock.fromJSON(value.layout);restored=true;}}catch{dock.clear();}
    if(!restored){
      const graph=dock.addPanel({id:'atlas.graph',title:'Architecture',component:'graph'});
      const navigator=dock.addPanel({id:'atlas.navigator',title:'Atlas',component:'navigator',position:{referencePanel:graph,direction:'left'}});
      const files=dock.addPanel({id:'atlas.filesystem',title:'Filesystem',component:'filesystem',position:{referencePanel:graph,direction:'right'}});
      dock.addPanel({id:'atlas.inspector',title:'Inspector',component:'details',position:{referencePanel:files,direction:'below'}});
      const metrics=dock.addPanel({id:'atlas.metrics',title:'Functions & coverage',component:'metrics',position:{referencePanel:graph,direction:'below'}});
      dock.addPanel({id:'atlas.activity',title:'Activity & runs',component:'output',position:{referencePanel:metrics}});
      navigator.api.group.api.setSize({width:280});files.api.group.api.setSize({width:340});metrics.api.group.api.setSize({height:300});files.api.setActive();metrics.api.setActive();graph.api.setActive();
    }
    const persist=()=>{const value={version:2,layout:dock.toJSON()};state.setLayout(value);localStorage.setItem('atlas.workbench.v2',JSON.stringify(value));};
    const layout=dock.onDidLayoutChange(persist),removed=dock.onDidRemovePanel(panel=>dirtyPanels.delete(panel.id));
    const filePanels=new Map<string,string>();let previewId:string|undefined,previewResource='';
    for(const panel of dock.panels){const params=panel.api.getParameters<{contextId?:string;path?:string}>();if(panel.api.component==='file'&&params.contextId&&params.path)filePanels.set(`${params.contextId}:${params.path}`,panel.id);}
    const openFile=(event:Event)=>{const resource=(event as CustomEvent<{contextId:string;path:string;pinned?:boolean;line?:number}>).detail,key=`${resource.contextId}:${resource.path}`,mapped=filePanels.get(key);if(mapped){const panel=dock.getPanel(mapped);if(panel){panel.api.setActive();window.dispatchEvent(new CustomEvent('atlas:file-reveal',{detail:{panelId:mapped,line:resource.line}}));return;}filePanels.delete(key);}if(!resource.pinned&&previewId){const current=dock.getPanel(previewId);if(current&&!dirtyPanels.has(previewId)){filePanels.delete(previewResource);current.api.updateParameters({...resource,panelId:previewId});previewResource=key;filePanels.set(key,previewId);current.api.setTitle(`${resource.path.split('/').at(-1)??resource.path} · preview`);current.api.setActive();return;}}const id=resource.pinned?`file:${key}`:`file:preview:${crypto.randomUUID()}`;if(!resource.pinned){previewId=id;previewResource=key;}filePanels.set(key,id);dock.addPanel({id,title:`${resource.path.split('/').at(-1)??resource.path}${resource.pinned?'':' · preview'}`,component:'file',tabComponent:'guarded-file',params:{...resource,panelId:id},renderer:'always',position:{referencePanel:'atlas.graph'}});};
    const dirtyFile=(event:Event)=>{const detail=(event as CustomEvent<{panelId?:string;dirty:boolean}>).detail,id=detail.panelId;if(!id)return;const panel=dock.getPanel(id);if(detail.dirty){dirtyPanels.add(id);if(id===previewId){previewId=undefined;previewResource='';}if(panel&&!panel.title?.endsWith(' ●'))panel.api.setTitle((panel.title??'File').replace(' · preview','')+' ●');}else{dirtyPanels.delete(id);if(panel)panel.api.setTitle((panel.title??'File').replace(/ ●$/,''));}};
    const openTerminal=()=>{let panel=dock.getPanel('atlas.terminal');if(!panel)panel=dock.addPanel({id:'atlas.terminal',title:'Terminal',component:'terminal',renderer:'always',position:{referencePanel:dock.getPanel('atlas.metrics')??dock.getPanel('atlas.graph')!}});panel.api.setActive();};
    const focusFiles=()=>dock.getPanel('atlas.filesystem')?.api.setActive();const confirm=(event:Event)=>pendingClose=(event as CustomEvent<any>).detail;
    const unload=(event:BeforeUnloadEvent)=>{if(dirtyPanels.size)event.preventDefault();};
    window.addEventListener('atlas:open-file',openFile);window.addEventListener('atlas:file-dirty',dirtyFile);window.addEventListener('atlas:open-terminal',openTerminal);window.addEventListener('atlas:focus-files',focusFiles);window.addEventListener('atlas:confirm-close',confirm);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener('atlas:open-file',openFile);window.removeEventListener('atlas:file-dirty',dirtyFile);window.removeEventListener('atlas:open-terminal',openTerminal);window.removeEventListener('atlas:focus-files',focusFiles);window.removeEventListener('atlas:confirm-close',confirm);window.removeEventListener('beforeunload',unload);layout.dispose();removed.dispose();dock.dispose();};
  });
</script>

<div class="workbench"><div class="root-dock" bind:this={host}></div>{#if pendingClose}<div class="atlas-dialog-backdrop" role="presentation"><div class="atlas-dialog" role="dialog" aria-modal="true" aria-labelledby="close-title"><h2 id="close-title">Discard changes?</h2><p>{pendingClose.title} has unsaved changes.</p><div><button onclick={()=>pendingClose=null}>Keep editing</button><button class="danger" onclick={()=>{const panel=pendingClose!;pendingClose=null;dirtyPanels.delete(panel.api.id);panel.api.close();}}>Discard</button></div></div></div>{/if}</div>
