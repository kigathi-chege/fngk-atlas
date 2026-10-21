<script lang="ts">
  import {onMount} from 'svelte';
  import {EditorState,type Extension} from '@codemirror/state';
  import {EditorView,lineNumbers} from '@codemirror/view';
  import {syntaxHighlighting,HighlightStyle} from '@codemirror/language';
  import {tags} from '@lezer/highlight';
  import {javascript} from '@codemirror/lang-javascript';import {css} from '@codemirror/lang-css';import {json} from '@codemirror/lang-json';import {html} from '@codemirror/lang-html';import {markdown} from '@codemirror/lang-markdown';import {python} from '@codemirror/lang-python';
  import {MergeView,unifiedMergeView,goToNextChunk,goToPreviousChunk} from '@codemirror/merge';
  import {api,ApiError} from '../lib/api.js';
  import {announceGitChange,gitGet,gitPost} from '../lib/git/git-api.js';
  import {gitStatusStore} from '../lib/git/git-status-store.js';
  import Columns2 from '@lucide/svelte/icons/columns-2';import Rows2 from '@lucide/svelte/icons/rows-2';import RefreshCw from '@lucide/svelte/icons/refresh-cw';import FileText from '@lucide/svelte/icons/file-text';import Plus from '@lucide/svelte/icons/plus';import Minus from '@lucide/svelte/icons/minus';import ArrowUp from '@lucide/svelte/icons/arrow-up';import ArrowDown from '@lucide/svelte/icons/arrow-down';

  let {params={}}:{params?:Record<string,unknown>}=$props();
  // PanelHost re-creates this panel when its file or view changes, so the first values are final.
  const initial=(()=>params)();
  const contextId=typeof initial.contextId==='string'?initial.contextId:'local',file=typeof initial.path==='string'?initial.path:'',view=initial.view==='staged'?'staged':'working';
  let host:HTMLDivElement;let merge:MergeView|undefined;let single:EditorView|undefined;
  let inline=$state((()=>{try{return localStorage.getItem('atlas.git.diff.inline')==='1'}catch{return false}})());
  let status=$state('Loading diff…');let error=$state('');let root='';let texts={a:'',b:''};let generation=0;
  const name=file.split('/').pop()||file;
  const highlight=HighlightStyle.define([{tag:[tags.keyword,tags.modifier],color:'#c792ea'},{tag:[tags.function(tags.variableName),tags.definition(tags.variableName)],color:'#82aaff'},{tag:[tags.string,tags.special(tags.string)],color:'#c3e88d'},{tag:[tags.number,tags.bool,tags.null],color:'#f78c6c'},{tag:[tags.typeName,tags.className],color:'#ffcb6b'},{tag:tags.comment,color:'#637777',fontStyle:'italic'},{tag:[tags.propertyName,tags.attributeName],color:'#f07178'},{tag:tags.tagName,color:'#ff5370'}]);
  function language():Extension{const ext=name.toLowerCase().split('.').pop()??'';if(ext==='svelte'||ext==='html'||ext==='htm')return html();if(['ts','tsx','js','jsx','mjs','cjs'].includes(ext))return javascript({typescript:ext.startsWith('t'),jsx:ext.endsWith('x')});if(['css','scss','less'].includes(ext))return css();if(ext==='json')return json();if(ext==='md'||ext==='markdown')return markdown();if(ext==='py')return python();return []}
  // A MergeView scrolls as one unit; a single inline editor scrolls itself.
  const readOnly=(fill=false)=>[EditorState.readOnly.of(true),EditorView.editable.of(false),lineNumbers(),language(),syntaxHighlighting(highlight),...(fill?[EditorView.theme({'&':{height:'100%'},'.cm-scroller':{overflow:'auto'}})]:[])];

  async function repositoryRoot(){if(root)return root;const folder=file.slice(0,file.lastIndexOf('/'))||'/';const value=await gitStatusStore.discover(contextId,folder);if(!value)throw new Error('This file is not inside a git repository.');root=value;return root}
  const relativePath=()=>root==='/'?file.slice(1):file.slice(root.length+1);
  async function revision(ref:string){const value=await gitGet<{exists:boolean;binary:boolean;tooLarge:boolean;text:string}>('show',{contextId,file,ref});if(value.binary)throw new Error('Binary file: no text diff.');if(value.tooLarge)throw new Error('The file is too large to diff.');return value.text}
  async function workingTree(){try{const value=await api<any>(`/api/files/content?contextId=${encodeURIComponent(contextId)}&path=${encodeURIComponent(file)}`);if(value.binary)throw new Error('Binary file: no text diff.');if(value.tooLarge)throw new Error('The file is too large to diff.');return String(value.text??'')}catch(failure){if(failure instanceof ApiError&&failure.status===404)return '';throw failure}}

  function render(){
    merge?.destroy();single?.destroy();merge=undefined;single=undefined;host.replaceChildren();
    if(inline)single=new EditorView({parent:host,state:EditorState.create({doc:texts.b,extensions:[...readOnly(true),unifiedMergeView({original:texts.a,mergeControls:false,highlightChanges:true,gutter:true,collapseUnchanged:{margin:3,minSize:6}})]})});
    else merge=new MergeView({parent:host,a:{doc:texts.a,extensions:readOnly()},b:{doc:texts.b,extensions:readOnly()},highlightChanges:true,gutter:true,collapseUnchanged:{margin:3,minSize:6}});
    const chunks=merge?.chunks.length??0;
    status=`${view==='staged'?'HEAD ↔ staged':'staged ↔ working tree'}${merge?` · ${chunks} change${chunks===1?'':'s'}`:''}`;
  }
  async function load(){
    const token=++generation;error='';
    try{
      await repositoryRoot();
      const [a,b]=view==='staged'?await Promise.all([revision('HEAD'),revision(':')]):await Promise.all([revision(':'),workingTree()]);
      if(token!==generation)return;texts={a,b};render();
    }catch(failure){if(token===generation){error=(failure as Error).message;status=''}}
  }
  function toggle(){inline=!inline;try{localStorage.setItem('atlas.git.diff.inline',inline?'1':'0')}catch{}render()}
  function step(next:boolean){const target=merge?.b??single;if(target){(next?goToNextChunk:goToPreviousChunk)(target);target.focus()}}
  async function stageToggle(){try{await repositoryRoot();await gitPost(view==='staged'?'unstage':'stage',{contextId,root,paths:[relativePath()]});announceGitChange(contextId,root)}catch(failure){error=(failure as Error).message}}
  const open=()=>window.dispatchEvent(new CustomEvent('atlas:open-file',{detail:{contextId,path:file,pinned:true}}));

  onMount(()=>{
    const changed=(event:Event)=>{const detail=(event as CustomEvent<{contextId?:string;root?:string;path?:string}>).detail;if(!detail?.contextId||detail.contextId===contextId)void load()};
    const saved=(event:Event)=>{const detail=(event as CustomEvent<{contextId?:string;path?:string}>).detail;if(detail?.contextId===contextId&&detail.path===file)void load()};
    window.addEventListener('atlas:git-changed',changed);window.addEventListener('atlas:buffer-saved',saved);void load();
    return()=>{window.removeEventListener('atlas:git-changed',changed);window.removeEventListener('atlas:buffer-saved',saved);merge?.destroy();single?.destroy()};
  });
</script>
<section class="panel git-diff-panel" aria-label={`Diff of ${name}`}>
  <header><div class="git-diff-title"><strong>{name}</strong><span>{error||status}</span></div>
    <div class="git-diff-tools">
      <button title="Previous change" aria-label="Previous change" onclick={()=>step(false)}><ArrowUp size={13}/></button>
      <button title="Next change" aria-label="Next change" onclick={()=>step(true)}><ArrowDown size={13}/></button>
      <button title={inline?'Side by side':'Inline'} aria-label={inline?'Show side by side':'Show inline'} aria-pressed={inline} onclick={toggle}>{#if inline}<Columns2 size={13}/>{:else}<Rows2 size={13}/>{/if}</button>
      <button title={view==='staged'?'Unstage file':'Stage file'} aria-label={view==='staged'?'Unstage file':'Stage file'} onclick={stageToggle}>{#if view==='staged'}<Minus size={13}/>{:else}<Plus size={13}/>{/if}</button>
      <button title="Open file" aria-label="Open file" onclick={open}><FileText size={13}/></button>
      <button title="Refresh diff" aria-label="Refresh diff" onclick={load}><RefreshCw size={13}/></button>
    </div>
  </header>
  <div class="git-diff-body" bind:this={host}></div>
</section>
<style>
  .git-diff-panel{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--atlas-surface-0)}
  header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;border-bottom:1px solid var(--atlas-border)}
  .git-diff-title{display:flex;align-items:baseline;gap:8px;min-width:0}.git-diff-title span{color:var(--atlas-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .git-diff-tools{display:flex;gap:2px}.git-diff-tools button{display:inline-flex;align-items:center;padding:2px 5px;min-height:22px;border:0;background:transparent;color:var(--atlas-text-soft)}.git-diff-tools button:hover{background:var(--atlas-hover);color:var(--atlas-text)}
  .git-diff-body{flex:1;min-height:0;overflow:hidden;font-size:12px}
  .git-diff-body :global(.cm-mergeView){height:100%;overflow:auto}
  .git-diff-body>:global(.cm-editor){height:100%}
</style>
