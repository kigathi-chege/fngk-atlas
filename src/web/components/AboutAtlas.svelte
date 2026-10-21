<script lang="ts">
  import {onMount} from 'svelte';
  import {api} from '../lib/api.js';
  type Info={desktop:boolean;atlasVersion:string;fngk:{bundledVersion?:string;installedVersion?:string;installPath:string;provision?:string;provisionError?:string;manifestUrl:string};update?:{status:string;version?:string;currentVersion?:string;message?:string;checkedAt?:string}};
  type UpdateCheck={currentVersion?:string;latestVersion?:string;available:boolean;errorCode?:string;message?:string};
  let open=false,info:Info|undefined,check:UpdateCheck|undefined,busy=false,error='',done='';
  const load=async()=>{error='';try{info=await api<Info>('/api/desktop/info')}catch(cause){error=(cause as Error).message}};
  const checkFngk=async()=>{busy=true;error='';done='';try{check=await api<UpdateCheck>('/api/fngk/signed-update')}catch(cause){error=(cause as Error).message}finally{busy=false}};
  const updateFngk=async()=>{busy=true;error='';done='';try{const value=await api<{result:{message:string}}>('/api/fngk/signed-update',{method:'POST',body:JSON.stringify({confirm:true})});done=value.result.message;check=undefined;await load()}catch(cause){error=(cause as Error).message}finally{busy=false}};
  const atlasUpdate=(update:Info['update'])=>!update?'Not checked yet.':update.status==='available'?`Atlas ${update.version} is available. Atlas has offered to restart and update; it asks again at the next launch.`:update.status==='current'?'Atlas is up to date.':update.status==='disabled'?`Automatic updates are off: ${update.message??'not configured'}.`:update.status==='installing'?`Installing Atlas ${update.version}…`:update.status==='error'?`Update check failed: ${update.message??'unknown error'}`:update.status;
  onMount(()=>{const show=()=>{open=true;void load()};window.addEventListener('atlas:open-about',show);return()=>window.removeEventListener('atlas:open-about',show)});
</script>

{#if open}<div class="about-backdrop"><section class="about-atlas" role="dialog" aria-modal="true" aria-label="About Atlas">
  <header><h2>About Atlas</h2><button aria-label="Close About Atlas" onclick={()=>open=false}>×</button></header>
  {#if info}<dl>
    <dt>Atlas</dt><dd data-testid="about-atlas-version">{info.atlasVersion}{info.desktop?' (desktop)':''}</dd>
    {#if info.desktop}<dt>Atlas updates</dt><dd>{atlasUpdate(info.update)}</dd>{/if}
    <dt>Bundled FNGK</dt><dd data-testid="about-fngk-bundled">{info.fngk.bundledVersion??'none (web host)'}</dd>
    <dt>Installed FNGK</dt><dd data-testid="about-fngk-installed">{info.fngk.installedVersion??'not installed'} <small>{info.fngk.installPath}</small></dd>
    {#if info.fngk.provisionError}<dt>FNGK setup</dt><dd class="warn">{info.fngk.provisionError}</dd>{/if}
  </dl>
  <div class="actions"><button onclick={checkFngk} disabled={busy}>Check for FNGK update</button>{#if check?.available}<button onclick={updateFngk} disabled={busy}>Update FNGK to {check.latestVersion}</button>{/if}</div>
  {#if check}<p>{check.available?`FNGK ${check.latestVersion} is available (installed: ${check.currentVersion??'none'}).`:check.errorCode?`FNGK update check failed: ${check.message}`:`FNGK ${check.currentVersion??''} is current.`}</p>{/if}
  {#if done}<p>{done}</p>{/if}
  {:else if !error}<p>Loading…</p>{/if}
  {#if error}<p role="alert" class="warn">{error}</p>{/if}
</section></div>{/if}

<style>
  .about-backdrop{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:#0008}
  .about-atlas{display:grid;gap:10px;width:min(480px,calc(100vw - 32px));padding:14px 16px;border:1px solid var(--atlas-border,#283847);border-radius:10px;background:var(--atlas-panel,#111a23);color:inherit}
  header{display:flex;justify-content:space-between;align-items:center}h2{margin:0;font-size:15px}header button{border:0;background:none;color:inherit;font-size:18px}
  dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;margin:0;font-size:12px}dt{color:var(--atlas-muted,#91a2b2)}dd{margin:0;overflow-wrap:anywhere}small{color:var(--atlas-muted,#91a2b2)}
  .actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{padding:6px 10px;border:0;border-radius:6px;background:#3e9f8e;color:#07110f;font-weight:700}.actions button:disabled{opacity:.6}
  p{margin:0;font-size:12px}.warn{color:#f3a33b}
</style>
