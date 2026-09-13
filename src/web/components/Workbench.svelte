<script lang="ts">
  import { onMount, mount, unmount } from 'svelte';
  import { createDockview, type GroupPanelPartInitParameters, type IContentRenderer, type ITabRenderer, type TabPartInitParameters } from 'dockview';
  import { writable } from 'svelte/store';
  import PanelHost from './PanelHost.svelte';
  import MinimizedTray from './MinimizedTray.svelte';
  import {PanelRegistry,type AtlasPanelDescriptor} from '../lib/panel-registry.js';
  import type { WorkbenchState } from '../lib/workbench-state.js';

  export let state: WorkbenchState;
  let host: HTMLDivElement; let pendingClose: { api: any; title: string } | null = null; let empty = false;let minimized:AtlasPanelDescriptor[]=[];
  const dirtyPanels = new Set<string>();
  const panelRegistry=new PanelRegistry();

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
    let dock:ReturnType<typeof createDockview>;const minimizing=new Set<string>();
    const remember=(panel:any)=>panelRegistry.remember({id:panel.id,kind:panel.api.component,title:panel.title??panel.id,params:panel.api.getParameters()});
    const minimizePanel=(panel:any)=>{remember(panel);panelRegistry.minimize(panel.id);minimizing.add(panel.id);dock.removePanel(panel);};
    dock=createDockview(host,{createComponent:({name})=>new Renderer(name),createTabComponent:({name})=>name==='guarded-file'?new GuardedFileTab():undefined,getTabContextMenuItems:({panel}:any)=>[{label:'Minimize',action:()=>minimizePanel(panel)},'separator','float','maximize','separator',...(dirtyPanels.has(panel.id)?[]:['close','closeOthers','closeAll'])] as any});
    const saved=localStorage.getItem('atlas.workbench.v2');let restored=false;
    if(saved)try{const value=JSON.parse(saved);if(value?.version===2&&value.layout){dock.fromJSON(value.layout);restored=true;}}catch{dock.clear();}
    const seed=()=>{
      const graph=dock.getPanel('atlas.graph')??dock.addPanel({id:'atlas.graph',title:'Architecture',component:'graph'});
      const navigator=dock.addPanel({id:'atlas.navigator',title:'Atlas',component:'navigator',position:{referencePanel:graph,direction:'left'}});
      const files=dock.addPanel({id:'atlas.filesystem',title:'Filesystem',component:'filesystem',position:{referencePanel:graph,direction:'right'}});
      dock.addPanel({id:'atlas.inspector',title:'Inspector',component:'details',position:{referencePanel:files,direction:'below'}});
      const metrics=dock.addPanel({id:'atlas.metrics',title:'Functions & coverage',component:'metrics',position:{referencePanel:graph,direction:'below'}});
      dock.addPanel({id:'atlas.activity',title:'Activity & runs',component:'output',position:{referencePanel:metrics}});
      navigator.api.group.api.setSize({width:280});files.api.group.api.setSize({width:340});metrics.api.group.api.setSize({height:300});files.api.setActive();metrics.api.setActive();graph.api.setActive();
    };
    if(!restored){dock.clear();seed();}for(const panel of dock.panels)remember(panel);
    try{const savedMinimized=JSON.parse(localStorage.getItem('atlas.minimized-panels.v1')??'[]');if(Array.isArray(savedMinimized))for(const descriptor of savedMinimized){panelRegistry.remember(descriptor);panelRegistry.minimize(descriptor.id)}}catch{}
    const syncEmpty=()=>{empty=dock.panels.length===0;}; syncEmpty();
    const persist=()=>{const value={version:2,layout:dock.toJSON()};state.setLayout(value);localStorage.setItem('atlas.workbench.v2',JSON.stringify(value));};
    const updateMinimized=()=>{minimized=panelRegistry.all().filter(value=>value.minimized);localStorage.setItem('atlas.minimized-panels.v1',JSON.stringify(minimized))};updateMinimized();
    const layout=dock.onDidLayoutChange(persist),removed=dock.onDidRemovePanel((panel:any)=>{const wasMinimized=minimizing.delete(panel.id);if(!wasMinimized){dirtyPanels.delete(panel.id);panelRegistry.forget(panel.id)}if(panel.id==='atlas.navigator'&&dock.panels.length>0&&!wasMinimized){const graph=dock.getPanel('atlas.graph')??dock.panels[0];const added=dock.addPanel({id:'atlas.navigator',title:'Atlas',component:'navigator',position:graph?{referencePanel:graph,direction:'left'}:undefined});remember(added);}updateMinimized();syncEmpty();persist();});
    const restorePanel=(id:string)=>{const descriptor=panelRegistry.restore(id);if(!descriptor)return;let panel=dock.getPanel(id);if(!panel){const reference=dock.getPanel('atlas.graph')??dock.panels[0];panel=dock.addPanel({id:descriptor.id,title:descriptor.title,component:descriptor.kind,tabComponent:descriptor.kind==='file'?'guarded-file':undefined,params:descriptor.params,renderer:['file','terminal'].includes(descriptor.kind)?'always':undefined,position:reference?{referencePanel:reference}:undefined});}panel.api.setActive();updateMinimized();syncEmpty();};
    const forgetPanel=(id:string)=>{panelRegistry.forget(id);updateMinimized()};
    (host as any).__atlasRestorePanel=restorePanel;(host as any).__atlasForgetPanel=forgetPanel;
    const filePanels=new Map<string,string>();let previewId:string|undefined,previewResource='';
    for(const panel of dock.panels){const params=panel.api.getParameters<{contextId?:string;path?:string}>();if(panel.api.component==='file'&&params.contextId&&params.path)filePanels.set(`${params.contextId}:${params.path}`,panel.id);}
    const openFile=(event:Event)=>{const resource=(event as CustomEvent<{contextId:string;path:string;pinned?:boolean;line?:number}>).detail,key=`${resource.contextId}:${resource.path}`,mapped=filePanels.get(key);if(mapped){const panel=dock.getPanel(mapped);if(panel){panel.api.setActive();window.dispatchEvent(new CustomEvent('atlas:file-reveal',{detail:{panelId:mapped,line:resource.line}}));return;}filePanels.delete(key);}if(!resource.pinned&&previewId){const current=dock.getPanel(previewId);if(current&&!dirtyPanels.has(previewId)){filePanels.delete(previewResource);current.api.updateParameters({...resource,panelId:previewId});previewResource=key;filePanels.set(key,previewId);current.api.setTitle(`${resource.path.split('/').at(-1)??resource.path} · preview`);current.api.setActive();return;}}const id=resource.pinned?`file:${key}`:`file:preview:${crypto.randomUUID()}`;if(!resource.pinned){previewId=id;previewResource=key;}filePanels.set(key,id);dock.addPanel({id,title:`${resource.path.split('/').at(-1)??resource.path}${resource.pinned?'':' · preview'}`,component:'file',tabComponent:'guarded-file',params:{...resource,panelId:id},renderer:'always',position:{referencePanel:'atlas.graph'}});};
    const dirtyFile=(event:Event)=>{const detail=(event as CustomEvent<{panelId?:string;dirty:boolean}>).detail,id=detail.panelId;if(!id)return;const panel=dock.getPanel(id);if(detail.dirty){dirtyPanels.add(id);if(id===previewId){previewId=undefined;previewResource='';}if(panel&&!panel.title?.endsWith(' ●'))panel.api.setTitle((panel.title??'File').replace(' · preview','')+' ●');}else{dirtyPanels.delete(id);if(panel)panel.api.setTitle((panel.title??'File').replace(/ ●$/,''));}};
    const ensureBase=()=>{if(dock.panels.length===0)seed();return dock.getPanel('atlas.graph')??dock.panels[0];};
    const focusSearch=()=>{ensureBase();dock.getPanel('atlas.navigator')?.api.setActive();};
    const openTerminal=(event?:Event)=>{const resource=(event as CustomEvent<{contextId?:string;target?:string;session?:string;sessionId?:string;title?:string;newSession?:boolean;create?:boolean}>)?.detail??{},selected=resource.contextId??state.snapshot().contextId,target=resource.target??(selected.startsWith('device:')?selected:''),id='atlas.terminal';let panel=dock.getPanel(id);const request={target,session:resource.sessionId??resource.session??'',newSession:resource.create===true||resource.newSession===true,requestId:crypto.randomUUID(),panelId:id};if(!panel)panel=dock.addPanel({id,title:resource.title??'Terminal',component:'terminal',renderer:'always',params:request,position:{referencePanel:dock.getPanel('atlas.metrics')??ensureBase(),direction:'below'}});else if(resource.session||resource.sessionId||resource.create||resource.newSession||target!==panel.api.getParameters<{target?:string}>().target)panel.api.updateParameters(request);panel.api.setActive();syncEmpty();};
    const closeTerminal=(event:Event)=>{const id=(event as CustomEvent<{panelId?:string}>).detail?.panelId;if(id)dock.getPanel(id)?.api.close();};
    const openDatabase=(event:Event)=>{const contextId=(event as CustomEvent<{contextId?:string}>).detail?.contextId??state.snapshot().contextId,id=`database:${contextId}`;let panel=dock.getPanel(id);if(!panel)panel=dock.addPanel({id,title:'Databases',component:'database',renderer:'always',params:{contextId},position:{referencePanel:dock.getPanel('atlas.graph')!}});panel.api.setActive();};
    const focusFiles=()=>{ensureBase();let panel=dock.getPanel('atlas.filesystem');if(!panel)panel=dock.addPanel({id:'atlas.filesystem',title:'Filesystem',component:'filesystem',position:{referencePanel:ensureBase(),direction:'right'}});panel.api.setActive();syncEmpty();};
    const openRoot=(event:Event)=>{const detail=(event as CustomEvent<{contextId:string;path:string}>).detail;if(!detail?.contextId||!detail.path)return;state.setContext(detail.contextId);focusFiles();queueMicrotask(()=>window.dispatchEvent(new CustomEvent('atlas:filesystem-root',{detail})));};
    const shortcuts=()=>{ensureBase();focusSearch();}; const confirm=(event:Event)=>pendingClose=(event as CustomEvent<any>).detail;
    const unload=(event:BeforeUnloadEvent)=>{if(dirtyPanels.size)event.preventDefault();};
    window.addEventListener('atlas:open-file',openFile);window.addEventListener('atlas:file-dirty',dirtyFile);window.addEventListener('atlas:open-terminal',openTerminal);window.addEventListener('atlas:close-terminal',closeTerminal);window.addEventListener('atlas:open-database',openDatabase);window.addEventListener('atlas:focus-files',focusFiles);window.addEventListener('atlas:open-root',openRoot);window.addEventListener('atlas:focus-search',focusSearch);window.addEventListener('atlas:shortcuts',shortcuts);window.addEventListener('atlas:confirm-close',confirm);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener('atlas:open-file',openFile);window.removeEventListener('atlas:file-dirty',dirtyFile);window.removeEventListener('atlas:open-terminal',openTerminal);window.removeEventListener('atlas:close-terminal',closeTerminal);window.removeEventListener('atlas:open-database',openDatabase);window.removeEventListener('atlas:focus-files',focusFiles);window.removeEventListener('atlas:open-root',openRoot);window.removeEventListener('atlas:focus-search',focusSearch);window.removeEventListener('atlas:shortcuts',shortcuts);window.removeEventListener('atlas:confirm-close',confirm);window.removeEventListener('beforeunload',unload);layout.dispose();removed.dispose();dock.dispose();};
  });
</script>

<div class="workbench"><div class="root-dock" bind:this={host}></div><MinimizedTray items={minimized} onrestore={(id)=>host&&(host as any).__atlasRestorePanel?.(id)} onforget={(id)=>host&&(host as any).__atlasForgetPanel?.(id)}/>{#if empty}<section class="dock-empty-recovery" aria-label="Restore Atlas panels"><strong>Atlas workspace is empty</strong><p>Restore a panel to continue working.</p><div><button onclick={()=>window.dispatchEvent(new Event('atlas:focus-search'))}>Search</button><button onclick={()=>window.dispatchEvent(new Event('atlas:focus-files'))}>Filesystem</button><button onclick={()=>window.dispatchEvent(new Event('atlas:open-terminal'))}>Terminal</button><button onclick={()=>window.dispatchEvent(new Event('atlas:shortcuts'))}>Command palette</button></div></section>{/if}{#if pendingClose}<div class="atlas-dialog-backdrop" role="presentation"><div class="atlas-dialog" role="dialog" aria-modal="true" aria-labelledby="close-title"><h2 id="close-title">Discard changes?</h2><p>{pendingClose.title} has unsaved changes.</p><div><button onclick={()=>pendingClose=null}>Keep editing</button><button class="danger" onclick={()=>{const panel=pendingClose!;pendingClose=null;dirtyPanels.delete(panel.api.id);panel.api.close();}}>Discard</button></div></div></div>{/if}</div>
<style>
  .workbench{position:relative}.dock-empty-recovery{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:8px;background:#080b0f;color:#dbe5ee;text-align:center}.dock-empty-recovery strong{font-size:16px}.dock-empty-recovery p{margin:0;color:#8996a5;font-size:12px}.dock-empty-recovery div{display:flex;gap:7px;flex-wrap:wrap;justify-content:center}.dock-empty-recovery button{padding:7px 11px;font-size:11px}
</style>
