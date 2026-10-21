<script lang="ts">
  import {onMount} from 'svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';import ChevronDown from '@lucide/svelte/icons/chevron-down';import CaseSensitive from '@lucide/svelte/icons/case-sensitive';import Regex from '@lucide/svelte/icons/regex';import WholeWord from '@lucide/svelte/icons/whole-word';import Replace from '@lucide/svelte/icons/replace';import Undo2 from '@lucide/svelte/icons/undo-2';
  import DeviceChip from './DeviceChip.svelte';import {api} from '../lib/api.js';import {notify} from '../lib/notifications.js';import type {WorkbenchState} from '../lib/workbench-state.js';
  import {openEditors,type OpenEditor} from '../lib/open-editors.js';import {takeSearchRequest,minimalChange,type SearchRequest} from '../lib/search-requests.js';
  import {compileQuery,computeHunks,parseGlobs,pathFilter,type Hunk} from '../../files/text-query.js';
  export let state:WorkbenchState;

  interface FileHunks {path:string;fingerprint:string;hunks:Hunk[];selected:Set<number>;open:boolean;source:'disk'|'buffer';editor?:OpenEditor;snapshot?:string;status?:string;message?:string}
  interface FoundFile {path:string;open:boolean;matches:Array<{line:number;column:number;length:number;preview:string}>}
  interface UndoBatch {contextId:string;disk:Array<{path:string;fingerprint:string;previousFingerprint:string}>;buffers:Array<{path:string;editor:OpenEditor;before:string;after:string}>}

  let contextId=state.snapshot().contextId,workbenchContext=contextId,root='/',rootEdited=false,query='',replacement='',caseSensitive=false,regex=false,wholeWord=false,include='',exclude='node_modules, .git',showReplace=false,showFilters=false;
  let busy=false,message='',error='',found:FoundFile[]=[],preview:FileHunks[]=[],skipped:Array<{path:string;reason:string;message?:string}>=[],undo:UndoBatch|undefined,queryInput:HTMLInputElement,replaceInput:HTMLInputElement;
  const flags=()=>({query,replacement,regex,caseSensitive,wholeWord});
  const relative=(value:string)=>root==='/'?value.replace(/^\//,''):value.startsWith(`${root}/`)?value.slice(root.length+1):'';
  const display=(value:string)=>relative(value)||value;
  $: selectedCount=preview.reduce((total,file)=>total+(file.status?0:file.selected.size),0);

  function workspaceRoot(id:string){try{const roots=JSON.parse(localStorage.getItem('atlas.workspace-roots.v1')??'[]') as Array<{contextId:string;path:string;kind:string}>;return roots.find(value=>value.contextId===id&&value.kind==='workspace')?.path??roots.find(value=>value.contextId===id&&value.kind==='pinned')?.path??'/'}catch{return '/'}}
  function adopt(request:SearchRequest|undefined){if(!request)return;if(request.contextId&&request.contextId!==contextId){contextId=request.contextId;rootEdited=false}if(request.root){root=request.root;rootEdited=true}else if(!rootEdited)root=workspaceRoot(contextId);if(request.query)query=request.query;if(request.replace)showReplace=true;if(request.run&&request.query&&!request.replace)queueMicrotask(()=>void find());queueMicrotask(()=>{(request.replace&&query?replaceInput:queryInput)?.focus();(request.replace&&query?replaceInput:queryInput)?.select()})}
  function reset(){found=[];preview=[];skipped=[];message='';error=''}
  function validate(){try{compileQuery(flags());return true}catch(failure){error=(failure as Error).message;return false}}
  const body=()=>({contextId,root,...flags(),include:parseGlobs(include),exclude:parseGlobs(exclude)});

  async function find(){if(!query||busy||!validate())return;busy=true;reset();message='Searching…';try{const value=await api<any>('/api/files/find',{method:'POST',body:JSON.stringify(body())});found=(value.files??[]).map((file:any)=>({...file,open:true}));const total=found.reduce((sum,file)=>sum+file.matches.length,0);const where=value.root??root,stopped=value.reason==='time'||value.reason==='stalled',note=value.truncated?(stopped?` · stopped after ${Math.max(1,Math.round((value.elapsedMs??0)/1000))}s, narrow the folder`:' · limit reached, refine the search'):'';message=found.length?`${total} result${total===1?'':'s'} in ${found.length} file${found.length===1?'':'s'} under ${where}${note}`:stopped?`No results in ${where} before the search stopped after ${Math.max(1,Math.round((value.elapsedMs??0)/1000))}s — narrow the folder.`:`No results in ${where}.`}catch(failure){error=(failure as Error).message;message=''}finally{busy=false}}

  // Dirty editors are previewed from their unsaved buffer, not the disk copy.
  function bufferEntries(){const accept=pathFilter(parseGlobs(include),parseGlobs(exclude)),values:FileHunks[]=[];for(const editor of openEditors.all()){if(editor.contextId!==contextId||!editor.path||!editor.dirty())continue;const rel=relative(editor.path);if(!rel&&editor.path!==root)continue;if(!accept(rel))continue;const snapshot=editor.content(),hunks=computeHunks(snapshot,flags());if(hunks.length)values.push({path:editor.path,fingerprint:editor.fingerprint(),hunks,selected:new Set(hunks.map(hunk=>hunk.id)),open:true,source:'buffer',editor,snapshot})}return values}
  async function previewReplace(){if(!query||busy||!validate())return;busy=true;reset();message='Preparing preview…';try{const value=await api<any>('/api/files/replace/preview',{method:'POST',body:JSON.stringify(body())});const buffers=bufferEntries(),covered=new Set(buffers.map(file=>file.path));preview=[...buffers,...(value.files??[]).filter((file:any)=>!covered.has(file.path)).map((file:any)=>({path:file.path,fingerprint:file.fingerprint,hunks:file.hunks,selected:new Set<number>(file.hunks.map((hunk:Hunk)=>hunk.id)),open:true,source:'disk' as const}))].sort((left,right)=>left.path.localeCompare(right.path));skipped=value.skipped??[];const total=preview.reduce((sum,file)=>sum+file.hunks.length,0);message=preview.length?`${total} replacement${total===1?'':'s'} in ${preview.length} file${preview.length===1?'':'s'}${buffers.length?` · ${buffers.length} unsaved editor${buffers.length===1?'':'s'} edited in place`:''}`:'Nothing to replace.'}catch(failure){error=(failure as Error).message;message=''}finally{busy=false}}

  function toggleHunk(file:FileHunks,id:number){file.selected.has(id)?file.selected.delete(id):file.selected.add(id);preview=preview}
  function toggleFile(file:FileHunks){file.selected=file.selected.size===file.hunks.length?new Set():new Set(file.hunks.map(hunk=>hunk.id));preview=preview}
  function openMatch(path:string,line:number,column:number,length:number){window.dispatchEvent(new CustomEvent('atlas:open-file',{detail:{contextId,path,line,column,length}}))}

  async function refreshClean(path:string){const editors=openEditors.find(contextId,path).filter(editor=>!editor.dirty());if(!editors.length)return;const opened=await api<any>(`/api/files/content?contextId=${encodeURIComponent(contextId)}&path=${encodeURIComponent(path)}`);if(typeof opened.text!=='string')return;for(const editor of editors)if(!editor.dirty())editor.syncSaved(opened.text,opened.fingerprint)}

  async function apply(){if(busy||!selectedCount)return;busy=true;error='';const batch:UndoBatch={contextId,disk:[],buffers:[]},chosen=preview.filter(file=>!file.status&&file.selected.size);try{
      for(const file of chosen.filter(file=>file.source==='buffer')){const editor=file.editor!;if(!editor.dirty()||editor.content()!==file.snapshot){file.status='conflict';file.message='The editor changed after the preview.';continue}const changes=file.hunks.filter(hunk=>file.selected.has(hunk.id)).map(hunk=>({from:hunk.start,to:hunk.end,insert:hunk.replacement}));editor.applyChanges(changes);batch.buffers.push({path:file.path,editor,before:file.snapshot!,after:editor.content()});file.status='ok';file.message=`${changes.length} replaced in the unsaved editor · save to keep`}
      const disk=chosen.filter(file=>file.source==='disk');
      if(disk.length){const value=await api<any>('/api/files/replace/apply',{method:'POST',body:JSON.stringify({...body(),edits:disk.map(file=>({path:file.path,expectedFingerprint:file.fingerprint,selectedHunks:[...file.selected]}))})});
        for(const result of value.results??[]){const file=disk.find(item=>item.path===result.path);if(!file)continue;file.status=result.status;file.message=result.status==='ok'?`${result.applied} replaced${result.versioned?' · previous version kept':''}`:result.message;if(result.status==='ok'&&result.applied){batch.disk.push({path:result.path,fingerprint:result.fingerprint,previousFingerprint:result.previousFingerprint});await refreshClean(result.path).catch(()=>{})}}}
      preview=preview;const ok=chosen.filter(file=>file.status==='ok').length,conflicts=chosen.filter(file=>file.status==='conflict').length,failed=chosen.filter(file=>file.status==='failed').length;
      message=`Replaced in ${ok} file${ok===1?'':'s'}${conflicts?` · ${conflicts} changed since the preview (not modified)`:''}${failed?` · ${failed} failed`:''}`;
      if(batch.disk.length||batch.buffers.length)undo=batch;
      if(conflicts||failed)notify(message,'error','search-replace');
    }catch(failure){error=(failure as Error).message}finally{busy=false}}

  async function undoReplace(){if(!undo||busy)return;busy=true;error='';const batch=undo;let restored=0;const problems:string[]=[];try{
      for(const item of batch.disk){try{await api('/api/files/versions/restore',{method:'POST',body:JSON.stringify({contextId:batch.contextId,path:item.path,versionFingerprint:item.previousFingerprint,expectedFingerprint:item.fingerprint})});restored++;await refreshClean(item.path).catch(()=>{})}catch(failure:any){problems.push(`${display(item.path)}: ${failure.status===409?'changed since the replace':failure.message}`)}}
      for(const item of batch.buffers){if(item.editor.content()!==item.after){problems.push(`${display(item.path)}: editor changed since the replace (use Ctrl+Z in the editor)`);continue}item.editor.applyChanges([minimalChange(item.after,item.before)]);restored++}
      undo=undefined;preview=[];message=`Undid the replace in ${restored} file${restored===1?'':'s'}${problems.length?` · ${problems.length} skipped`:''}`;if(problems.length){error=problems.join('\n');notify(`Undo skipped ${problems.length} file${problems.length===1?'':'s'}.`,'error','search-undo')}
    }finally{busy=false}}

  function submit(event:KeyboardEvent){if(event.key==='Enter'){event.preventDefault();void(showReplace?previewReplace():find())}if(event.key==='Escape'&&(found.length||preview.length)){event.preventDefault();reset()}}
  function highlight(text:string){try{const expression=compileQuery(flags());expression.lastIndex=0;const match=expression.exec(text);if(!match||!match[0])return [{text,hit:false}];return [{text:text.slice(0,match.index),hit:false},{text:match[0],hit:true},{text:text.slice(match.index+match[0].length),hit:false}]}catch{return [{text,hit:false}]}}
  function pieces(hunk:Hunk){const start=hunk.column-1;if(hunk.line!==hunk.endLine||hunk.before.slice(start,start+hunk.match.length)!==hunk.match)return undefined;return {head:hunk.before.slice(0,start).trimStart(),tail:hunk.before.slice(start+hunk.match.length)}}
  const reasons:Record<string,string>={file_limit:'over the 200 file limit',too_large:'larger than 2 MB',binary:'binary',unreadable:'unreadable'};

  onMount(()=>{root=workspaceRoot(contextId);adopt(takeSearchRequest());const requested=(event:Event)=>adopt((event as CustomEvent<SearchRequest>).detail??takeSearchRequest()),unsubscribe=state.subscribe(value=>{if(value.contextId===workbenchContext)return;workbenchContext=value.contextId;if(contextId===value.contextId)return;contextId=value.contextId;if(!rootEdited)root=workspaceRoot(contextId);reset();undo=undefined});window.addEventListener('atlas:search-request',requested);queueMicrotask(()=>queueInputFocus());return()=>{window.removeEventListener('atlas:search-request',requested);unsubscribe()}});
  function queueInputFocus(){if(document.activeElement===document.body)queryInput?.focus()}
</script>

<section class="panel search-panel" aria-label="Search in files">
  <form class="sp-search-form" onsubmit={event=>{event.preventDefault();void(showReplace?previewReplace():find())}}>
    <div class="sp-search-row">
      <button type="button" class="sp-toggle-replace" aria-label={showReplace?'Hide replace':'Show replace'} aria-expanded={showReplace} onclick={()=>{showReplace=!showReplace;reset()}}>{#if showReplace}<ChevronDown size={14}/>{:else}<ChevronRight size={14}/>{/if}</button>
      <div class="sp-field-stack">
        <div class="sp-field"><input class="atlas-input" bind:this={queryInput} bind:value={query} placeholder="Search" aria-label="Search query" spellcheck="false" onkeydown={submit}/>
          <span class="sp-flags"><button type="button" aria-label="Match case" title="Match case" aria-pressed={caseSensitive} class:sp-on={caseSensitive} onclick={()=>caseSensitive=!caseSensitive}><CaseSensitive size={14}/></button><button type="button" aria-label="Match whole word" title="Match whole word" aria-pressed={wholeWord} class:sp-on={wholeWord} onclick={()=>wholeWord=!wholeWord}><WholeWord size={14}/></button><button type="button" aria-label="Use regular expression" title="Use regular expression" aria-pressed={regex} class:sp-on={regex} onclick={()=>regex=!regex}><Regex size={14}/></button></span></div>
        {#if showReplace}<div class="sp-field"><input class="atlas-input" bind:this={replaceInput} bind:value={replacement} placeholder={regex?'Replace ($1, $<name>, $& supported)':'Replace'} aria-label="Replacement" spellcheck="false" onkeydown={submit}/></div>{/if}
      </div>
    </div>
    <div class="sp-scope-row"><DeviceChip {contextId} compact/><label>in <input class="atlas-input" bind:value={root} onchange={()=>rootEdited=true} aria-label="Search root" spellcheck="false" onkeydown={submit}/></label><button type="button" class="sp-link" aria-expanded={showFilters} onclick={()=>showFilters=!showFilters}>{showFilters?'Hide filters':'Filters'}</button></div>
    {#if showFilters}<div class="sp-filters"><label>files to include<input class="atlas-input" bind:value={include} placeholder="e.g. *.ts, src/**" aria-label="Files to include" spellcheck="false" onkeydown={submit}/></label><label>files to exclude<input class="atlas-input" bind:value={exclude} placeholder="e.g. node_modules, dist/**" aria-label="Files to exclude" spellcheck="false" onkeydown={submit}/></label></div>{/if}
    <div class="sp-actions">
      {#if showReplace}<button type="submit" disabled={busy||!query}>Preview replace</button><button type="button" class="sp-primary" disabled={busy||!selectedCount} onclick={apply} aria-label="Apply replace"><Replace size={13}/>Replace {selectedCount||''}</button>{:else}<button type="submit" class="sp-primary" disabled={busy||!query}>Search</button>{/if}
      {#if undo}<button type="button" disabled={busy} onclick={undoReplace} aria-label="Undo replace"><Undo2 size={13}/>Undo replace</button>{/if}
    </div>
  </form>
  {#if error}<p class="sp-search-error" role="alert">{error}</p>{/if}
  {#if message}<p class="sp-search-status" role="status">{message}</p>{/if}
  <div class="sp-search-results">
    {#if showReplace}
      {#each preview as file (file.path)}
        <div class="sp-result-file" data-path={file.path}>
          <div class="sp-file-head"><button type="button" class="sp-twisty" aria-label={file.open?`Collapse ${display(file.path)}`:`Expand ${display(file.path)}`} onclick={()=>{file.open=!file.open;preview=preview}}>{#if file.open}<ChevronDown size={12}/>{:else}<ChevronRight size={12}/>{/if}</button><input type="checkbox" checked={file.selected.size===file.hunks.length} indeterminate={file.selected.size>0&&file.selected.size<file.hunks.length} disabled={Boolean(file.status)} aria-label={`Replace in ${display(file.path)}`} onchange={()=>toggleFile(file)}/><span class="sp-file-name" title={file.path}>{display(file.path)}</span>{#if file.source==='buffer'}<span class="sp-badge">unsaved editor</span>{/if}<span class="sp-count">{file.selected.size}/{file.hunks.length}</span></div>
          {#if file.status}<p class={`sp-file-status ${file.status}`}>{file.status==='ok'?'✓':file.status==='conflict'?'Conflict':'Failed'} · {file.message}</p>{/if}
          {#if file.open}<ul>{#each file.hunks.slice(0,200) as hunk (hunk.id)}{@const split=pieces(hunk)}<li><input type="checkbox" checked={file.selected.has(hunk.id)} disabled={Boolean(file.status)} aria-label={`Replace at line ${hunk.line} column ${hunk.column} in ${display(file.path)}`} onchange={()=>toggleHunk(file,hunk.id)}/><button type="button" class="sp-match" onclick={()=>openMatch(file.path,hunk.line,hunk.column,hunk.match.length)}><span class="sp-pos">{hunk.line}:{hunk.column}</span>{#if split}<span class="sp-text">{split.head}<del>{hunk.match}</del><ins>{hunk.replacement}</ins>{split.tail}</span>{:else}<span class="sp-text"><del>{hunk.before}</del> <ins>{hunk.after}</ins></span>{/if}</button></li>{/each}{#if file.hunks.length>200}<li class="sp-more">… {file.hunks.length-200} more in this file</li>{/if}</ul>{/if}
        </div>
      {/each}
      {#if skipped.length}<details class="sp-skipped"><summary>{skipped.length} file{skipped.length===1?'':'s'} skipped</summary><ul>{#each skipped as item}<li title={item.message??''}>{display(item.path)} · {reasons[item.reason]??item.reason}</li>{/each}</ul></details>{/if}
    {:else}
      {#each found as file (file.path)}
        <div class="sp-result-file" data-path={file.path}>
          <div class="sp-file-head"><button type="button" class="sp-twisty" aria-label={file.open?`Collapse ${display(file.path)}`:`Expand ${display(file.path)}`} onclick={()=>{file.open=!file.open;found=found}}>{#if file.open}<ChevronDown size={12}/>{:else}<ChevronRight size={12}/>{/if}</button><span class="sp-file-name" title={file.path}>{display(file.path)}</span><span class="sp-count">{file.matches.length}</span></div>
          {#if file.open}<ul>{#each file.matches as match}<li><button type="button" class="sp-match" onclick={()=>openMatch(file.path,match.line,match.column,match.length)}><span class="sp-pos">{match.line}:{match.column}</span><span class="sp-text">{#each highlight(match.preview) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span></button></li>{/each}</ul>{/if}
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  .search-panel{width:100%;min-width:0;overflow:hidden;font-size:11px}
  .sp-search-form{display:grid;grid-template-columns:minmax(0,1fr);gap:5px;padding:8px 8px 6px;border-bottom:1px solid var(--atlas-border)}
  .sp-search-row{display:flex;gap:4px;align-items:flex-start}
  .sp-toggle-replace{border:0;background:transparent;padding:4px 1px;color:var(--atlas-muted)}
  .sp-field-stack{flex:1;display:grid;grid-template-columns:minmax(0,1fr);gap:4px;min-width:0}
  .sp-field{display:flex;align-items:center;background:var(--atlas-surface-0);border:1px solid var(--atlas-border);border-radius:var(--atlas-radius-sm)}
  .sp-field:focus-within{border-color:var(--atlas-focus)}
  .sp-field input,.sp-scope-row input,.sp-filters input{flex:1;width:auto;min-width:0;border:0;border-radius:0;box-shadow:none;background:transparent;color:var(--atlas-text);padding:4px 6px;font:11px ui-monospace,monospace;outline:none}
  .sp-flags{flex:none;display:flex;gap:1px;padding-right:2px}
  .sp-flags button{border:1px solid transparent;background:transparent;color:var(--atlas-muted);padding:1px 2px;border-radius:3px;display:grid;place-items:center}
  .sp-flags button.sp-on{color:var(--atlas-accent);border-color:var(--atlas-accent);background:var(--atlas-accent-soft)}
  .sp-scope-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;padding-left:20px;color:var(--atlas-muted);font-size:10px}
  .sp-scope-row label{flex:1 1 140px;display:flex;align-items:center;gap:4px;min-width:0}
  .sp-scope-row input,.sp-filters input{background:var(--atlas-surface-0);border:1px solid var(--atlas-border);border-radius:var(--atlas-radius-sm)}
  .sp-scope-row input:focus,.sp-filters input:focus{border-color:var(--atlas-focus);box-shadow:none}
  .sp-link{border:0;background:transparent;color:var(--atlas-cyan);padding:0;font-size:10px}
  .sp-filters{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;padding-left:20px}
  .sp-filters label{display:grid;grid-template-columns:minmax(0,1fr);gap:2px;color:var(--atlas-muted);font-size:10px}
  .sp-actions{display:flex;flex-wrap:wrap;gap:4px;padding-left:20px}
  .sp-actions button{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;font-size:11px}
  .sp-actions .sp-primary{background:var(--atlas-accent-soft);border-color:var(--atlas-accent);color:var(--atlas-text)}
  .sp-search-status,.sp-search-error{margin:0;padding:5px 10px;font-size:10px;color:var(--atlas-muted);white-space:pre-wrap}
  .sp-search-error{color:var(--atlas-danger)}
  .sp-search-results{flex:1;min-height:0;overflow:auto;padding:2px 0 12px}
  .sp-result-file ul{list-style:none;margin:0;padding:0}
  .sp-file-head{display:flex;align-items:center;gap:4px;padding:2px 8px 2px 4px;position:sticky;top:0;z-index:1;background:var(--atlas-surface-1);box-shadow:0 1px 0 var(--atlas-border)}
  .sp-file-head .sp-twisty{border:0;background:transparent;padding:2px;color:var(--atlas-muted);display:grid;place-items:center}
  .sp-file-head input,.sp-result-file li input{margin:0;accent-color:var(--atlas-accent)}
  .sp-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;font-weight:550}
  .sp-count{color:var(--atlas-muted);font-size:10px;background:var(--atlas-surface-2);border-radius:8px;padding:0 6px}
  .sp-badge{font-size:9px;color:var(--atlas-warning);border:1px solid var(--atlas-warning);border-radius:3px;padding:0 4px}
  .sp-result-file li{display:flex;align-items:center;gap:4px;padding-left:24px}
  .sp-match{flex:1;min-width:0;display:flex;gap:6px;align-items:baseline;border:0;background:transparent;text-align:left;padding:2px 8px 2px 2px;border-radius:0;font:11px/1.45 ui-monospace,monospace;color:var(--atlas-text-soft)}
  .sp-match:hover{background:var(--atlas-hover)}
  .sp-pos{color:var(--atlas-muted);font-size:10px;flex:none}
  .sp-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:pre}
  mark{background:#f3c76b44;color:inherit;border-radius:2px}
  del{background:#ff8d8630;color:var(--atlas-danger);text-decoration:line-through}
  ins{background:#4ade8030;color:var(--atlas-success);text-decoration:none}
  .sp-file-status{margin:0;padding:1px 8px 3px 28px;font-size:10px;color:var(--atlas-muted)}
  .sp-file-status.ok{color:var(--atlas-success)}.sp-file-status.conflict{color:var(--atlas-warning)}.sp-file-status.failed{color:var(--atlas-danger)}
  .sp-more{color:var(--atlas-muted);padding:2px 0 2px 46px}
  .sp-skipped{margin:6px 10px;color:var(--atlas-muted);font-size:10px}
</style>
