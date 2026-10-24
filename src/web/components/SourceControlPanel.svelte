<script lang="ts">
  import {onMount} from 'svelte';
  import type {WorkbenchState} from '../lib/workbench-state.js';
  import {contextDisplayName} from '../lib/device-directory.js';
  import {notify} from '../lib/notifications.js';
  import {ApiError} from '../lib/api.js';
  import {announceGitChange,gitGet,gitPost,gitStream,needsConfirmation,type GitBranch,type GitCommit,type GitEntry,type GitStatusResult} from '../lib/git/git-api.js';
  import {gitStatusStore,toneFor} from '../lib/git/git-status-store.js';
  import '../lib/git/git.css';
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';import ArrowDown from '@lucide/svelte/icons/arrow-down';import ArrowUp from '@lucide/svelte/icons/arrow-up';import RefreshCw from '@lucide/svelte/icons/refresh-cw';import Plus from '@lucide/svelte/icons/plus';import Minus from '@lucide/svelte/icons/minus';import Undo2 from '@lucide/svelte/icons/undo-2';import FileText from '@lucide/svelte/icons/file-text';import ChevronDown from '@lucide/svelte/icons/chevron-down';import ChevronRight from '@lucide/svelte/icons/chevron-right';import Check from '@lucide/svelte/icons/check';import FolderGit2 from '@lucide/svelte/icons/folder-git-2';import CloudUpload from '@lucide/svelte/icons/cloud-upload';import Download from '@lucide/svelte/icons/download';import Ellipsis from '@lucide/svelte/icons/ellipsis';import X from '@lucide/svelte/icons/x';

  // `state` would collide with the $state rune (store auto-subscription), so it is renamed.
  let {params={},state:workbench}:{params?:Record<string,unknown>;state:WorkbenchState}=$props();

  type Confirm={title:string;body:string;action:string;run:()=>Promise<void>};
  const initial=(()=>params)(),initialContext=(()=>workbench.snapshot().contextId)();
  let contextId=$state(typeof initial.contextId==='string'?initial.contextId:initialContext);
  let root=$state(typeof initial.root==='string'?initial.root:'');
  let status=$state<GitStatusResult|undefined>();let identity=$state<{name?:string;email?:string;configured:boolean}|undefined>();
  let branches=$state<GitBranch[]>([]);let remotes=$state<string[]>([]);let commits=$state<GitCommit[]>([]);let moreHistory=$state(false);
  let message=$state('');let busy=$state('');let error=$state('');let confirm=$state<Confirm|undefined>();
  let identityForm=$state<{name:string;email:string}|undefined>();let branchForm=$state<string|undefined>();let menuOpen=$state(false);
  let collapsed=$state<Record<string,boolean>>({});let historyOpen=$state(true);let expanded=$state('');
  let sync=$state<{operation:string;lines:string[];done?:boolean;ok?:boolean;message?:string}|undefined>();let syncOpen=$state(false);
  let pathInput=$state('');let cloneForm=$state<{url:string;destination:string}|undefined>();
  let known=$state<string[]>([]);let loading=$state(false);let generation=0;

  const remember=(value:string)=>{try{localStorage.setItem(`atlas.git.repository.${contextId}`,value)}catch{}};
  const recall=()=>{try{return localStorage.getItem(`atlas.git.repository.${contextId}`)??''}catch{return ''}};
  const base=(value:string)=>value.split('/').pop()||value;
  const folderOf=(value:string)=>{const index=value.lastIndexOf('/');return index>0?value.slice(0,index):''};
  const entries=$derived(status?.entries??[]);
  const groups=$derived({
    conflicts:entries.filter(entry=>entry.groups.includes('conflicts')),
    staged:entries.filter(entry=>entry.groups.includes('staged')),
    changes:entries.filter(entry=>entry.groups.includes('changes')),
    untracked:entries.filter(entry=>entry.groups.includes('untracked')),
  });
  const branch=$derived(status?.branch);
  const head=$derived(branch?.detached?`detached ${branch.oid?.slice(0,7)??''}`:branch?.head??'');
  const localBranches=$derived(branches.filter(value=>!value.remote));
  const remoteBranches=$derived(branches.filter(value=>value.remote&&!localBranches.some(local=>remotes.some(remote=>`${remote}/${local.name}`===value.name))));
  const relative=(iso:string)=>{const seconds=Math.max(0,(Date.now()-Date.parse(iso))/1000);if(seconds<60)return 'now';if(seconds<3600)return `${Math.floor(seconds/60)}m`;if(seconds<86400)return `${Math.floor(seconds/3600)}h`;if(seconds<86400*30)return `${Math.floor(seconds/86400)}d`;return new Date(iso).toLocaleDateString()};

  function fail(value:unknown){const err=value as ApiError;if(err?.code==='identity_required'){identityForm={name:identity?.name??'',email:identity?.email??''};error='';return}error=err?.message??String(value)}

  async function load(full=true){
    if(!root)return;const token=++generation;loading=true;error='';
    try{
      const value=await gitStatusStore.refresh(contextId,root);if(token!==generation)return;
      if(!value){status={repository:null};return}
      status=value.result;if(value.root!==root){root=value.root}remember(root);
      if(full){
        const [who,listing,history]=await Promise.all([gitGet<any>('identity',{contextId,root}),gitGet<any>('branches',{contextId,root}),gitGet<any>('log',{contextId,root,limit:30})]);
        if(token!==generation)return;identity=who;branches=listing.branches??[];remotes=listing.remotes??[];commits=history.commits??[];moreHistory=(history.commits??[]).length===30;
      }
    }catch(value){if(token===generation)fail(value)}finally{if(token===generation)loading=false}
  }
  async function changed(full=true){announceGitChange(contextId,root);await load(full)}

  async function act(label:string,run:()=>Promise<unknown>,full=false){if(busy)return;busy=label;error='';try{await run();await changed(full)}catch(value){fail(value)}finally{busy=''}}
  const stage=(paths:string[])=>act('stage',()=>gitPost('stage',{contextId,root,paths}));
  const unstage=(paths:string[])=>act('unstage',()=>gitPost('unstage',{contextId,root,paths}));
  function discard(list:GitEntry[]){
    const paths=list.map(entry=>entry.path),untracked=list.filter(entry=>entry.kind==='untracked').length;
    confirm={title:list.length===1?`Discard changes to ${base(list[0].path)}?`:`Discard ${list.length} changes?`,body:`${untracked?`${untracked===list.length?'The files':'Untracked files'} will be deleted. `:''}A backup is saved on ${contextDisplayName(contextId)} first.`,action:'Discard',run:async()=>{await act('discard',async()=>{const result=await gitPost<{backup:string}>('discard',{contextId,root,paths,confirm:true});notify(`Discarded. Backup: ${result.backup}`,'success')})}};
  }
  async function commit(){
    if(!message.trim()||busy)return;if(!groups.staged.length){error='Stage changes before committing.';return}
    await act('commit',async()=>{const result=await gitPost<{hash:string}>('commit',{contextId,root,message});message='';notify(`Committed ${result.hash.slice(0,7)}.`,'success')},true);
  }
  async function saveIdentity(){if(!identityForm)return;const value=identityForm;await act('identity',async()=>{identity=await gitPost<any>('identity',{contextId,root,name:value.name,email:value.email});identityForm=undefined},true)}
  async function switchTo(name:string,confirmed=false){
    if(!name||busy)return;busy='switch';error='';
    try{await gitPost('switch',{contextId,root,branch:name,confirm:confirmed});busy='';await changed(true)}
    catch(value){busy='';if(needsConfirmation(value))confirm={title:`Switch to ${name}?`,body:'The working tree has uncommitted changes. git carries them over when it can and refuses otherwise.',action:'Switch',run:()=>switchTo(name,true)};else fail(value)}
  }
  async function createBranch(){const name=branchForm?.trim();if(!name)return;branchForm=undefined;await act('branch',()=>gitPost('branches',{contextId,root,name}),true)}
  function deleteBranch(name:string){confirm={title:`Delete ${name}?`,body:'Force-deleting can lose commits that are not merged anywhere.',action:'Delete',run:()=>act('branch',()=>gitPost('branches/delete',{contextId,root,name,force:true,confirm:true}),true)}}

  async function runSync(operation:'fetch'|'pull'|'push'|'clone',body:Record<string,unknown>){
    if(busy)return;busy=operation;error='';sync={operation,lines:[]};syncOpen=true;
    try{
      const result=await gitStream(operation,{contextId,root,...body},event=>{if(event.type==='output'&&event.text&&sync){const parts=event.text.split('\n');const lines=[...sync.lines];if(lines.length)lines[lines.length-1]+=parts.shift();lines.push(...parts);sync={...sync,lines:lines.slice(-400)}}});
      sync={...sync!,done:true,ok:result.ok,message:result.message};if(result.ok)syncOpen=false;
      if(!result.ok)error=result.message??`${operation} failed.`;
    }catch(value){sync={...sync!,done:true,ok:false,message:(value as Error).message};fail(value)}
    finally{busy='';if(operation!=='clone')await changed(true)}
  }
  const publish=()=>runSync('push',{remote:remotes.includes('origin')?'origin':remotes[0],branch:branch?.head,setUpstream:true});
  const forcePush=()=>{menuOpen=false;confirm={title:'Force push?',body:'This overwrites the remote branch with yours. It is refused if the remote moved since your last fetch.',action:'Force push',run:()=>runSync('push',{force:true,confirm:true})}};
  const stash=(action:'push'|'pop')=>{menuOpen=false;void act('stash',()=>gitPost('stash',{contextId,root,action,includeUntracked:action==='push'}))};
  async function clone(){if(!cloneForm)return;const value=cloneForm;cloneForm=undefined;await runSync('clone',{url:value.url,destination:value.destination});if(sync?.ok)choose(value.destination)}

  function openDiff(entry:GitEntry,view:'working'|'staged'){window.dispatchEvent(new CustomEvent('atlas:open-git-diff',{detail:{contextId,path:entry.logicalPath,view}}))}
  function openFile(entry:GitEntry){window.dispatchEvent(new CustomEvent('atlas:open-file',{detail:{contextId,path:entry.logicalPath,pinned:true}}))}
  async function loadMore(){try{const history=await gitGet<any>('log',{contextId,root,limit:30,skip:commits.length});commits=[...commits,...(history.commits??[])];moreHistory=(history.commits??[]).length===30}catch(value){fail(value)}}
  function choose(value:string){const next=value.trim();if(!next.startsWith('/'))return;status=undefined;commits=[];branches=[];identity=undefined;root=next;pathInput='';void load()}
  function pick(){window.dispatchEvent(new CustomEvent('atlas:pick-directory',{detail:{contextId,path:'/',target:'source-control'}}))}
  const keydown=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void commit()}};

  // A request to open a specific repository while the panel is already open.
  $effect(()=>{const requested=typeof params.root==='string'?params.root:'';if(requested&&requested!==root)choose(requested)});

  onMount(()=>{
    const refreshKnown=()=>{known=gitStatusStore.repositories(contextId).map(value=>value.root)};
    const unsubscribeStore=gitStatusStore.subscribe(()=>{refreshKnown();const value=root?gitStatusStore.repositories(contextId).find(item=>item.root===root):undefined;if(value&&value.result!==status&&!busy)status=value.result});
    const unsubscribeState=initial.contextId?()=>{}:workbench.subscribe(value=>{if(value.contextId===contextId)return;contextId=value.contextId;status=undefined;commits=[];branches=[];root=recall();refreshKnown();if(root)void load()});
    const picked=(event:Event)=>{const detail=(event as CustomEvent<{contextId:string;path:string;target?:string}>).detail;if(detail?.target==='source-control'&&detail.contextId===contextId)choose(detail.path)};
    const external=(event:Event)=>{const detail=(event as CustomEvent<{contextId?:string;root?:string}>).detail;if(detail?.contextId===contextId&&detail.root===root&&!busy)void load(false)};
    const focus=()=>{if(root&&!busy)void load(false)};
    window.addEventListener('atlas:directory-picked',picked);window.addEventListener('atlas:git-changed',external);window.addEventListener('focus',focus);
    if(!root)root=recall();refreshKnown();
    if(root)void load();else gitStatusStore.observe(contextId,'/');
    return()=>{unsubscribeStore();unsubscribeState();window.removeEventListener('atlas:directory-picked',picked);window.removeEventListener('atlas:git-changed',external);window.removeEventListener('focus',focus)};
  });
</script>

{#snippet row(entry:GitEntry,group:'staged'|'changes'|'untracked'|'conflicts')}
  {@const letter=group==='staged'?(entry.index==='T'?'M':entry.index):group==='changes'?(entry.worktree==='T'?'M':entry.worktree):entry.letter}
  <li class="scm-row" data-git={toneFor(letter)}>
    <button class="scm-file" title={entry.origPath?`${entry.origPath} → ${entry.path}`:entry.path} onclick={()=>group==='untracked'?openFile(entry):openDiff(entry,group==='staged'?'staged':'working')}>
      <span class="scm-name">{base(entry.path)}</span><span class="scm-dir">{entry.origPath?`${base(entry.origPath)} → `:''}{folderOf(entry.path)}</span>
    </button>
    <span class="scm-actions">
      <button title="Open file" aria-label={`Open ${entry.path}`} onclick={()=>openFile(entry)}><FileText size={13}/></button>
      {#if group==='staged'}<button title="Unstage" aria-label={`Unstage ${entry.path}`} onclick={()=>unstage([entry.path])}><Minus size={13}/></button>
      {:else}{#if group!=='conflicts'}<button title="Discard changes" aria-label={`Discard ${entry.path}`} onclick={()=>discard([entry])}><Undo2 size={13}/></button>{/if}<button title={group==='conflicts'?'Mark resolved':'Stage'} aria-label={`Stage ${entry.path}`} onclick={()=>stage([entry.path])}><Plus size={13}/></button>{/if}
    </span>
    <span class="scm-letter" title={letter}>{letter}</span>
  </li>
{/snippet}

{#snippet group(id:'conflicts'|'staged'|'changes'|'untracked',title:string,list:GitEntry[])}
  {#if list.length}
    <section class="scm-group" aria-label={title}>
      <header><button class="scm-toggle" onclick={()=>collapsed={...collapsed,[id]:!collapsed[id]}}>{#if collapsed[id]}<ChevronRight size={12}/>{:else}<ChevronDown size={12}/>{/if}<span>{title}</span><b>{list.length}</b></button>
        <span class="scm-actions">
          {#if id==='staged'}<button title="Unstage all" aria-label="Unstage all" onclick={()=>unstage(list.map(entry=>entry.path))}><Minus size={13}/></button>
          {:else if id!=='conflicts'}<button title="Discard all" aria-label={`Discard all ${title.toLowerCase()}`} onclick={()=>discard(list)}><Undo2 size={13}/></button><button title="Stage all" aria-label={`Stage all ${title.toLowerCase()}`} onclick={()=>stage(list.map(entry=>entry.path))}><Plus size={13}/></button>{/if}
        </span>
      </header>
      {#if !collapsed[id]}<ul>{#each list as entry (entry.path+id)}{@render row(entry,id)}{/each}</ul>{/if}
    </section>
  {/if}
{/snippet}

<section class="panel scm-panel" aria-label="Source Control" aria-busy={loading||Boolean(busy)}>
  <header class="scm-header">
    <div class="scm-title"><strong>Source Control</strong><span title={root}>{contextDisplayName(contextId)}{root?` · ${root}`:''}</span></div>
    <div class="scm-tools">
      {#if root}<button title="Refresh" aria-label="Refresh source control" disabled={loading} onclick={()=>load()}><RefreshCw size={13}/></button>{/if}
      <button title="Choose repository" aria-label="Choose repository" onclick={()=>{root='';status=undefined}}><FolderGit2 size={13}/></button>
    </div>
  </header>

  {#if !root||status?.repository===null}
    <div class="scm-empty">
      {#if status?.repository===null}<p>{root} is not inside a git repository.</p>{/if}
      {#if known.length}<span class="scm-label">Repositories on {contextDisplayName(contextId)}</span><ul class="scm-known">{#each known as value}<li><button onclick={()=>choose(value)}><FolderGit2 size={13}/>{value}</button></li>{/each}</ul>{/if}
      <form class="scm-inline" onsubmit={(event)=>{event.preventDefault();choose(pathInput)}}><input class="atlas-input" bind:value={pathInput} placeholder="/path/to/repository" aria-label="Repository folder"/><button disabled={!pathInput.startsWith('/')}>Open</button><button type="button" onclick={pick}>Browse…</button></form>
      {#if cloneForm}<form class="scm-inline scm-clone" onsubmit={(event)=>{event.preventDefault();void clone()}}><input class="atlas-input" bind:value={cloneForm.url} placeholder="Repository URL" aria-label="Clone URL"/><input class="atlas-input" bind:value={cloneForm.destination} placeholder="/destination/folder" aria-label="Clone destination"/><button disabled={!cloneForm.url||!cloneForm.destination.startsWith('/')}>Clone</button><button type="button" title="Cancel" onclick={()=>cloneForm=undefined}><X size={13}/></button></form>
      {:else}<button class="scm-link" onclick={()=>cloneForm={url:'',destination:''}}>Clone a repository…</button>{/if}
      {#if sync}<pre class="scm-log" class:failed={sync.done&&!sync.ok}>{sync.lines.join('\n')}{sync.message?`\n${sync.message}`:''}</pre>{/if}
      {#if error}<p class="scm-error">{error}</p>{/if}
    </div>
  {:else}
    <div class="scm-branchbar">
      <label class="scm-branch" title="Switch branch"><GitBranchIcon size={13}/>
        <select aria-label="Branch" value={branch?.head??''} disabled={Boolean(busy)} onchange={(event)=>{const value=(event.currentTarget as HTMLSelectElement).value;(event.currentTarget as HTMLSelectElement).value=branch?.head??'';if(value==='__new')branchForm='';else void switchTo(value)}}>
          {#if branch?.detached||branch?.unborn&&!localBranches.length}<option value={branch?.head??''}>{head}</option>{/if}
          {#each localBranches as value}<option value={value.name}>{value.name}</option>{/each}
          {#if remoteBranches.length}<optgroup label="Remote">{#each remoteBranches as value}<option value={value.name}>{value.name}</option>{/each}</optgroup>{/if}
          <option value="__new">New branch…</option>
        </select>
      </label>
      {#if branch?.upstream}<span class="scm-track" title={`Tracking ${branch.upstream}`}>{branch.ahead?`↑${branch.ahead}`:''}{branch.behind?` ↓${branch.behind}`:''}{!branch.ahead&&!branch.behind?'✓':''}</span>{/if}
      <span class="scm-sync">
        {#if remotes.length}
          <button title="Fetch" aria-label="Fetch" disabled={Boolean(busy)} onclick={()=>runSync('fetch',{})}><Download size={13}/></button>
          {#if branch?.upstream}
            <button title="Pull" aria-label="Pull" disabled={Boolean(busy)} onclick={()=>runSync('pull',{})}><ArrowDown size={13}/>{branch.behind||''}</button>
            <button title="Push" aria-label="Push" disabled={Boolean(busy)} onclick={()=>runSync('push',{})}><ArrowUp size={13}/>{branch.ahead||''}</button>
          {:else if branch?.head}<button title="Publish branch" aria-label="Publish branch" disabled={Boolean(busy)} onclick={publish}><CloudUpload size={13}/>Publish</button>{/if}
        {/if}
        <span class="scm-more"><button title="More actions" aria-label="More git actions" onclick={()=>menuOpen=!menuOpen}><Ellipsis size={13}/></button>
          {#if menuOpen}<div class="scm-menu atlas-popup" role="menu">
            <button role="menuitem" onclick={()=>stash('push')}>Stash changes</button>
            <button role="menuitem" onclick={()=>stash('pop')}>Pop latest stash</button>
            <button role="menuitem" onclick={()=>{menuOpen=false;branchForm=''}}>New branch…</button>
            {#if localBranches.filter(value=>!value.current).length}<span class="scm-menu-label">Delete branch</span>{#each localBranches.filter(value=>!value.current) as value}<button role="menuitem" class="danger" onclick={()=>{menuOpen=false;deleteBranch(value.name)}}>{value.name}</button>{/each}{/if}
            {#if branch?.upstream}<button role="menuitem" class="danger" onclick={forcePush}>Force push…</button>{/if}
          </div>{/if}
        </span>
      </span>
    </div>
    {#if branchForm!==undefined}<form class="scm-inline" onsubmit={(event)=>{event.preventDefault();void createBranch()}}><input class="atlas-input" bind:value={branchForm} placeholder="new-branch-name" aria-label="New branch name"/><button disabled={!branchForm.trim()}>Create</button><button type="button" title="Cancel" onclick={()=>branchForm=undefined}><X size={13}/></button></form>{/if}

    <div class="scm-commit">
      <textarea class="atlas-textarea" bind:value={message} rows="2" placeholder={`Message (Ctrl+Enter to commit on ${head||'branch'})`} aria-label="Commit message" onkeydown={keydown}></textarea>
      <div class="scm-commit-row">
        <span class="scm-author" title={identity?.email??''}>{#if identity?.configured}{identity.name} &lt;{identity.email}&gt;{:else if identity}<button class="scm-link warn" onclick={()=>identityForm={name:identity?.name??'',email:identity?.email??''}}>Set author…</button>{/if}</span>
        <button class="scm-commit-button" disabled={!message.trim()||!groups.staged.length||Boolean(busy)} onclick={commit}><Check size={13}/>{busy==='commit'?'Committing…':`Commit${groups.staged.length?` ${groups.staged.length}`:''}`}</button>
      </div>
      {#if identityForm}<form class="scm-identity" onsubmit={(event)=>{event.preventDefault();void saveIdentity()}}><span>Author for this repository</span><input class="atlas-input" bind:value={identityForm.name} placeholder="Name" aria-label="Author name"/><input class="atlas-input" bind:value={identityForm.email} placeholder="email@example.com" aria-label="Author email"/><button disabled={!identityForm.name.trim()||!identityForm.email.includes('@')}>Save</button><button type="button" title="Cancel" onclick={()=>identityForm=undefined}><X size={13}/></button></form>{/if}
    </div>

    {#if error}<p class="scm-error" role="alert">{error}</p>{/if}
    {#if sync&&(syncOpen||!sync.done)}<div class="scm-log-wrap"><header><span>{sync.operation}{sync.done?(sync.ok?' · done':' · failed'):'…'}</span><button title="Hide output" aria-label="Hide output" onclick={()=>syncOpen=false}><X size={12}/></button></header><pre class="scm-log" class:failed={sync.done&&!sync.ok}>{sync.lines.join('\n').trim()}{sync.done&&sync.message&&!sync.ok?`\n${sync.message}`:''}</pre></div>{/if}

    <div class="scm-body">
      {@render group('conflicts','Merge conflicts',groups.conflicts)}
      {@render group('staged','Staged',groups.staged)}
      {@render group('changes','Changes',groups.changes)}
      {@render group('untracked','Untracked',groups.untracked)}
      {#if status&&!entries.length}<p class="scm-clean">No changes.</p>{/if}
      <section class="scm-group scm-history" aria-label="History">
        <header><button class="scm-toggle" onclick={()=>historyOpen=!historyOpen}>{#if historyOpen}<ChevronDown size={12}/>{:else}<ChevronRight size={12}/>{/if}<span>History</span></button></header>
        {#if historyOpen}<ul>{#each commits as value (value.hash)}<li class="scm-commit-entry" class:open={expanded===value.hash}><button onclick={()=>expanded=expanded===value.hash?'':value.hash} title={`${value.authorName} · ${new Date(value.authoredAt).toLocaleString()}`}><span class="scm-subject">{value.subject}</span>{#each value.refs as ref}<i class="scm-ref">{ref.replace('HEAD -> ','')}</i>{/each}<span class="scm-meta">{value.authorName} · {relative(value.authoredAt)}</span></button>{#if expanded===value.hash}<div class="scm-commit-detail"><code>{value.shortHash}</code> {value.authorName} &lt;{value.authorEmail}&gt; · {new Date(value.authoredAt).toLocaleString()}{#if value.body}<pre>{value.body}</pre>{/if}</div>{/if}</li>{:else}<li class="scm-clean">{branch?.unborn?'No commits yet.':'No history.'}</li>{/each}</ul>{#if moreHistory}<button class="scm-link" onclick={loadMore}>Load more</button>{/if}{/if}
      </section>
    </div>
  {/if}
  {#if confirm}<div class="atlas-dialog-backdrop" role="presentation"><div class="atlas-dialog" role="dialog" aria-modal="true" aria-labelledby="scm-confirm-title"><h2 id="scm-confirm-title">{confirm.title}</h2><p>{confirm.body}</p><div><button onclick={()=>confirm=undefined}>Cancel</button><button class="danger" onclick={()=>{const value=confirm!;confirm=undefined;void value.run()}}>{confirm.action}</button></div></div></div>{/if}
</section>

<style>
  .scm-panel{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--atlas-surface-0);color:var(--atlas-text);font-size:12px}
  .scm-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid var(--atlas-border)}
  .scm-title{display:flex;align-items:baseline;gap:8px;min-width:0}.scm-title span{color:var(--atlas-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .scm-tools,.scm-sync,.scm-actions{display:flex;align-items:center;gap:2px}
  button{display:inline-flex;align-items:center;gap:3px;padding:2px 5px;font-size:11px;min-height:22px}
  .scm-branchbar{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--atlas-border)}
  .scm-branch{display:flex;align-items:center;gap:4px;min-width:0;flex:1;color:var(--atlas-text-soft)}
  .scm-branch select{min-width:0;max-width:100%;background:transparent;color:var(--atlas-text);border:1px solid transparent;border-radius:var(--atlas-radius-sm);font:inherit;padding:1px 2px}
  .scm-branch select:hover,.scm-branch select:focus{border-color:var(--atlas-border)}
  .scm-track{color:var(--atlas-muted);font:11px ui-monospace,monospace}
  .scm-more{position:relative}.scm-menu{position:absolute;right:0;top:24px;z-index:30;display:grid;min-width:170px;padding:3px;background:var(--atlas-surface-2);border:1px solid var(--atlas-border-strong);border-radius:var(--atlas-radius-md);box-shadow:var(--atlas-shadow-popover)}
  .scm-menu button{justify-content:flex-start;border:0;background:transparent;width:100%}.scm-menu button:hover{background:var(--atlas-hover)}.scm-menu-label{padding:4px 6px 1px;color:var(--atlas-muted);font-size:10px}
  .danger{color:var(--atlas-danger)}
  .scm-commit{display:grid;gap:4px;padding:6px 8px;border-bottom:1px solid var(--atlas-border)}
  .scm-commit textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:38px;font:12px/1.35 inherit}
  .scm-commit-row{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .scm-author{color:var(--atlas-muted);font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .scm-commit-button{background:var(--atlas-accent-soft);border-color:var(--atlas-accent);color:var(--atlas-accent)}
  .scm-identity,.scm-inline{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 0}.scm-inline{padding:4px 8px}.scm-identity span{width:100%;color:var(--atlas-text-soft);font-size:11px}
  .scm-identity input,.scm-inline input{flex:1;min-width:120px;padding:3px 6px;font-size:12px}
  .scm-link{border:0;background:transparent;color:var(--atlas-cyan);padding:2px 0}.scm-link.warn{color:var(--atlas-warning)}
  .scm-error{margin:4px 8px;color:var(--atlas-danger);font-size:11px}
  .scm-body{flex:1;min-height:0;overflow:auto;padding-bottom:6px}
  .scm-group>header{display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 4px;height:24px}
  .scm-group>header .scm-actions{opacity:0}.scm-group>header:hover .scm-actions,.scm-group>header:focus-within .scm-actions{opacity:1}
  .scm-toggle{border:0;background:transparent;color:var(--atlas-text-soft);font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.04em;padding:0 2px}
  .scm-toggle b{margin-left:4px;padding:0 5px;border-radius:8px;background:var(--atlas-surface-3);color:var(--atlas-text);font-size:10px}
  ul{list-style:none;margin:0;padding:0}
  .scm-row{display:flex;align-items:center;gap:4px;height:22px;padding:0 8px 0 20px}
  .scm-row:hover{background:var(--atlas-hover)}
  .scm-file{flex:1;min-width:0;justify-content:flex-start;gap:6px;border:0;background:transparent;padding:0;color:var(--git-tone,var(--atlas-text))}
  .scm-name{white-space:nowrap}.scm-dir{color:var(--atlas-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .scm-row .scm-actions{opacity:0}.scm-row:hover .scm-actions,.scm-row:focus-within .scm-actions{opacity:1}
  .scm-actions button{border:0;background:transparent;padding:2px;min-height:20px;color:var(--atlas-text-soft)}.scm-actions button:hover{color:var(--atlas-text);background:var(--atlas-surface-3)}
  .scm-letter{width:12px;text-align:center;font:600 11px ui-monospace,monospace;color:var(--git-tone)}
  .scm-clean{padding:4px 20px;color:var(--atlas-muted)}
  .scm-log-wrap{margin:4px 8px;border:1px solid var(--atlas-border);border-radius:var(--atlas-radius-sm)}
  .scm-log-wrap header{display:flex;justify-content:space-between;align-items:center;padding:1px 4px 1px 6px;color:var(--atlas-text-soft);font-size:11px}.scm-log-wrap header button{border:0;background:transparent}
  .scm-log{margin:0;max-height:140px;overflow:auto;padding:4px 6px;background:var(--atlas-bg);font:11px/1.35 ui-monospace,monospace;color:var(--atlas-text-soft);white-space:pre-wrap}.scm-log.failed{color:var(--atlas-danger)}
  .scm-commit-entry>button{display:flex;width:100%;align-items:baseline;gap:6px;border:0;background:transparent;padding:2px 8px 2px 20px;text-align:left;min-height:22px}
  .scm-commit-entry>button:hover{background:var(--atlas-hover)}
  .scm-subject{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.scm-meta{color:var(--atlas-muted);font-size:10px;white-space:nowrap}
  .scm-ref{font-style:normal;font-size:10px;padding:0 4px;border-radius:3px;background:var(--atlas-accent-soft);color:var(--atlas-accent);white-space:nowrap}
  .scm-commit-detail{padding:2px 8px 6px 20px;color:var(--atlas-text-soft);font-size:11px}.scm-commit-detail pre{margin:4px 0 0;white-space:pre-wrap;font:inherit}.scm-commit-detail code{color:var(--atlas-muted)}
  .scm-empty{display:grid;gap:6px;padding:10px 8px;align-content:start}.scm-empty p{margin:0;color:var(--atlas-muted)}.scm-empty .scm-inline{padding:0}
  .scm-label{color:var(--atlas-muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  .scm-known button{border:0;background:transparent;gap:6px;width:100%;justify-content:flex-start}.scm-known button:hover{background:var(--atlas-hover)}
</style>
