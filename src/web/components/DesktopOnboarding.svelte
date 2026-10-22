<script lang="ts">
  import {onMount} from 'svelte';
  import {api} from '../lib/api.js';
  import {atlasEvents} from '../lib/atlas-events.js';
  import {tryOpenInBrowser} from '../lib/external-url.js';
  import {resolveOnboardingPresentation} from '../lib/onboarding-state.js';
  import FngkStatusCard from './FngkStatusCard.svelte';
  import AtlasInput from './ui/AtlasInput.svelte';

  // One step: "Sign in to Signal" signs in and adds this machine as a Device
  // (fngk login --pair), then Atlas starts the FNGK daemon and returns to the
  // workbench. Steps already done (an existing login or paired Device) are skipped.
  type SignIn={id:string;profile:string;signalUrl:string;authorizationUrl:string;userCode?:string;expiresAt:string;state:'waiting'|'authenticated'|'complete'|'failed'|'cancelled';pairing:boolean;account?:string;device?:{state:'paired'|'unavailable';alreadyPaired?:boolean};error?:{code:string;message:string};browserOpened?:boolean};
  let status:any,loading=true,checkedAt='',retry:number|undefined,error='',dismissed=false,selfHosted='',signIn:SignIn|null=null,phase:'idle'|'starting'|'waiting'|'daemon'|'pairing-fallback'|'done'='idle',pairingUrl='',copied=false,eventId='',timer:number|undefined;
  $: presentation=resolveOnboardingPresentation(status,error);
  $: defaultSignal=status?.signIn?.defaultSignalUrl??'https://signal.nipate.africa';
  $: signalHost=(()=>{try{return new URL(signIn?.signalUrl??(selfHosted.trim()||defaultSignal)).host}catch{return defaultSignal}})();
  const stopPolling=()=>{if(timer!==undefined){window.clearInterval(timer);timer=undefined}};
  const refresh=async()=>{loading=true;error='';try{status=await api('/api/onboarding/status')}catch(cause){error=(cause as Error).message}finally{loading=false;checkedAt=new Date().toLocaleTimeString()}};
  // A failure is often transient (Signal or the daemon restarting), so keep
  // re-checking in the background; the panel closes once FNGK is ready again.
  $: needsRecheck=phase==='idle'&&(presentation.kind==='atlas-unavailable'||status?.state==='recoverable-error');
  $: if(needsRecheck&&retry===undefined)retry=window.setInterval(()=>{if(!loading)void refresh()},5000);else if(!needsRecheck&&retry!==undefined){window.clearInterval(retry);retry=undefined}
  const finish=async()=>{phase='done';await refresh();atlasEvents.resolve(eventId,{message:'Atlas is signed in to Signal and connected to this machine.'});if(status?.state==='ready')window.setTimeout(()=>window.location.reload(),700)};
  const converge=async()=>{const id=`onboarding.converge:${crypto.randomUUID()}`;atlasEvents.begin({id,type:'onboarding.converge',title:'Start FNGK daemon',contextId:'local',panelId:'atlas.onboarding'});phase='daemon';loading=true;error='';try{await api('/api/onboarding/converge',{method:'POST',body:JSON.stringify({profile:signIn?.profile??status?.local?.profile,confirm:true})});atlasEvents.resolve(id,{message:'The FNGK daemon is running.'});if(signIn)await finish();else{phase='idle';await refresh()}}catch(cause){error=(cause as Error).message;loading=false;atlasEvents.fail(id,{message:error})}};
  const afterSignIn=async(value:SignIn)=>{stopPolling();if(value.device?.state==='unavailable'){phase='pairing-fallback';loading=false;return}await converge()};
  const poll=async()=>{if(!signIn)return;try{const value=await api<SignIn>(`/api/onboarding/signin/${encodeURIComponent(signIn.id)}`);signIn={...signIn,...value};if(value.state==='complete')await afterSignIn(signIn);else if(value.state==='failed'||value.state==='cancelled'){stopPolling();phase='idle';error=value.error?.message??'Sign-in did not complete.';atlasEvents.fail(eventId,{message:error})}}catch(cause){stopPolling();phase='idle';error=(cause as Error).message}};
  const begin=async()=>{eventId=`onboarding.signin:${crypto.randomUUID()}`;atlasEvents.begin({id:eventId,type:'onboarding.login',title:'Sign in to Signal',contextId:'local',panelId:'atlas.onboarding'});phase='starting';loading=true;error='';copied=false;try{signIn=await api<SignIn>('/api/onboarding/signin',{method:'POST',body:JSON.stringify({profile:status?.local?.profile,...(selfHosted.trim()?{signalUrl:selfHosted.trim()}:{})})});if(!signIn.browserOpened)signIn.browserOpened=tryOpenInBrowser(signIn.authorizationUrl);phase='waiting';loading=false;stopPolling();timer=window.setInterval(()=>void poll(),1500)}catch(cause){phase='idle';loading=false;error=(cause as Error).message;atlasEvents.fail(eventId,{message:error})}};
  const reopen=async()=>{if(!signIn)return;try{const value=await api<{browserOpened:boolean}>(`/api/onboarding/signin/${encodeURIComponent(signIn.id)}/open`,{method:'POST',body:'{}'});if(!value.browserOpened)tryOpenInBrowser(signIn.authorizationUrl)}catch(cause){error=(cause as Error).message}};
  const cancel=async()=>{stopPolling();const current=signIn;signIn=null;phase='idle';if(current)await api(`/api/onboarding/signin/${encodeURIComponent(current.id)}/cancel`,{method:'POST',body:'{}'}).catch(()=>{});atlasEvents.fail(eventId,{message:'Sign-in cancelled.'})};
  const copyLink=async()=>{if(!signIn)return;try{await navigator.clipboard.writeText(signIn.authorizationUrl);copied=true}catch{copied=false}};
  const pairFromDashboard=async()=>{loading=true;error='';try{await api('/api/onboarding/pair',{method:'POST',body:JSON.stringify({profile:signIn?.profile??status?.local?.profile,pairingUrl:pairingUrl.trim()})});await converge()}catch(cause){error=(cause as Error).message;loading=false}};
  // Installs the bundled (or signed) FNGK into the user's bin, then continues to sign-in.
  const install=async(update:boolean)=>{const id=`onboarding.install:${crypto.randomUUID()}`;atlasEvents.begin({id,type:'onboarding.install',title:update?'Update FNGK':'Install FNGK',contextId:'local',panelId:'atlas.onboarding'});loading=true;error='';try{await api(update?'/api/fngk/signed-update':'/api/onboarding/install',{method:'POST',body:JSON.stringify(update?{confirm:true}:{scope:'user',confirm:true})});atlasEvents.resolve(id,{message:update?'FNGK is up to date.':'FNGK is installed.'});await refresh()}catch(cause){error=(cause as Error).message;loading=false;atlasEvents.fail(id,{message:error})}};
  const skipDevice=async()=>{phase='idle';signIn=null;await refresh()};
  onMount(()=>{const recover=()=>{dismissed=false;void refresh()},returned=(event:Event)=>{const url=String((event as CustomEvent<{url?:string}>).detail?.url??'');if(url.startsWith('fngk-atlas://auth/')&&phase==='waiting')void poll()};window.addEventListener('atlas:recover',recover);window.addEventListener('atlas:deep-link',returned);void refresh();return()=>{stopPolling();if(retry!==undefined)window.clearInterval(retry);window.removeEventListener('atlas:recover',recover);window.removeEventListener('atlas:deep-link',returned)}});
</script>

{#if !dismissed&&(presentation.kind!=='quiet'||phase!=='idle')}{#if loading && !status && !error}<aside class="desktop-onboarding" aria-label="Atlas connection"><FngkStatusCard {status}/></aside>
{:else}<aside class="desktop-onboarding" aria-label={presentation.kind==='atlas-unavailable'?'Atlas connection':'FNGK setup'}>{#if presentation.kind==='setup'&&phase==='idle'}<FngkStatusCard {status}/>{/if}<button class="dismiss" aria-label="Dismiss connection setup" onclick={()=>dismissed=true}>×</button>
  <div class="setup-copy">
  {#if phase==='waiting'&&signIn}
    <h2>Approve in your browser</h2>
    <p>{signIn.browserOpened?'Your browser opened Signal.':'Open this link to continue.'} Sign in if asked, check the code, and approve adding this machine.</p>
    {#if signIn.userCode}<div class="code" aria-label="Sign-in code"><small>Code</small><code>{signIn.userCode}</code></div>{/if}
    <div class="link-row"><input class="atlas-input" readonly value={signIn.authorizationUrl} aria-label="Sign-in link" onfocus={event=>(event.currentTarget as HTMLInputElement).select()}/><button class="secondary" onclick={copyLink}>{copied?'Copied':'Copy'}</button></div>
    {#if !signIn.pairing}<p class="hint">This Signal cannot add Devices from sign-in yet; you will be signed in and can pair afterwards.</p>{/if}
    <p class="waiting" role="status">{signIn.state==='authenticated'?'Signed in. Adding this machine…':`Waiting for approval on ${signalHost}…`}</p>
    <div class="actions"><button onclick={reopen}>Open browser again</button><button class="secondary" onclick={cancel}>Cancel</button></div>
  {:else if phase==='starting'}
    <h2>Sign in to Signal</h2><p role="status">Starting a secure sign-in…</p>
  {:else if phase==='daemon'}
    <h2>Start FNGK daemon</h2><p role="status">{signIn?.account?`Signed in as ${signIn.account}. `:''}Starting the FNGK daemon on this machine…</p>
    {#if error}<div class="actions"><button onclick={converge} disabled={loading}>Try again</button><button class="secondary" onclick={finish}>Continue without the daemon</button></div>{/if}
  {:else if phase==='pairing-fallback'}
    <h2>Add this machine as a Device</h2>
    <p>{signIn?.account?`Signed in as ${signIn.account}. `:'Signed in. '}This Signal cannot add Devices from Atlas yet. Create a pairing link in the Signal dashboard and paste it here.</p>
    <label>Pairing link<AtlasInput bind:value={pairingUrl} placeholder={`${signIn?.signalUrl??defaultSignal}/device-pair/…`} ariaLabel="Device pairing link"/></label>
    <div class="actions"><button onclick={pairFromDashboard} disabled={loading||!pairingUrl.trim()}>Add Device</button><button class="secondary" onclick={skipDevice}>Skip</button></div>
  {:else if phase==='done'}
    <h2>Atlas is ready</h2><p role="status">{signIn?.account?`Signed in as ${signIn.account}. `:''}Returning to the workbench…</p>
  {:else}
    <h2>{status?.state==='login-choice'?'Sign in to Signal':presentation.title}</h2>
    <p>{status?.state==='login-choice'?'Atlas opens your browser to sign you in and add this machine to your Devices.':presentation.message}</p>
    {#if status?.state==='recoverable-error'&&status?.local?.detail}<p class="detail">{status.local.detail}</p>{/if}
    {#if needsRecheck}<p class="hint" role="status">{loading?'Checking…':`Checked at ${checkedAt}. Atlas keeps checking every few seconds.`}</p>{/if}
    {#if presentation.kind==='atlas-unavailable'}<button onclick={refresh} disabled={loading}>{loading?'Checking…':presentation.action}</button>
    {:else if status?.state==='daemon-install-choice'}<button onclick={converge} disabled={loading}>Start FNGK daemon</button>
    {:else if status?.state==='login-choice'}
      <button onclick={begin} disabled={loading}>Sign in to Signal</button>
      <details class="advanced"><summary>Advanced: use a self-hosted Signal</summary><label>Signal address<AtlasInput bind:value={selfHosted} placeholder="https://signal.example.com" ariaLabel="Self-hosted Signal address"/></label><small>Leave empty to use {signalHost}.</small></details>
    {:else if status?.state==='install-choice'}<p class="hint">Atlas needs FNGK on this machine to reach your Devices.</p><button onclick={()=>install(false)} disabled={loading}>Install FNGK</button>
    {:else if status?.state==='update-choice'}<p class="hint">A newer FNGK is required.</p><button onclick={()=>install(true)} disabled={loading}>Update FNGK</button>
    {:else}<button onclick={refresh} disabled={loading}>{loading?'Checking…':'Try again'}</button>{/if}
  {/if}
  {#if error}<small role="alert">{error}</small>{/if}
  </div></aside>{/if}{/if}

<style>
  /* Top right, so error notices (bottom right) never cover its buttons; above the
     dock so its resize handles cannot take the clicks, below dialogs and menus. */
  .desktop-onboarding{position:fixed;z-index:1100;top:52px;right:12px;max-height:calc(100vh - 130px);overflow:auto;display:grid;gap:8px;width:min(360px,calc(100vw - 24px));padding:10px;border:1px solid var(--atlas-border,#283847);border-radius:10px;background:color-mix(in srgb,var(--atlas-panel,#111a23) 96%,#000);box-shadow:0 12px 34px #0008}.dismiss{position:absolute;top:6px;right:8px;border:0;background:transparent;color:var(--atlas-muted,#91a2b2);cursor:pointer}.setup-copy{display:grid;gap:8px}.setup-copy h2{margin:0;font-size:14px}.setup-copy p{margin:0;color:var(--atlas-muted,#91a2b2);font-size:12px;line-height:1.4}.setup-copy label{display:grid;gap:4px;font-size:11px}.setup-copy button{justify-self:start;padding:7px 10px;font-size:12px;border:0;border-radius:6px;background:#3e9f8e;color:#07110f;font-weight:700;cursor:pointer}.setup-copy button.secondary{background:transparent;color:var(--atlas-text,#e5edf3);border:1px solid var(--atlas-border,#283847);font-weight:600}.setup-copy button:disabled{opacity:.6}.setup-copy small{color:#f3a33b}.hint{font-size:11px!important}.code{display:grid;gap:2px;padding:8px;border:1px solid var(--atlas-border,#283847);border-radius:6px;text-align:center}.code small{color:var(--atlas-muted,#91a2b2)!important;font-size:10px}.code code{font-size:18px;letter-spacing:.18em}.link-row{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center}.actions{display:flex;flex-wrap:wrap;gap:6px}.advanced summary{cursor:pointer;font-size:11px;color:var(--atlas-muted,#91a2b2)}.advanced{display:grid;gap:6px}.advanced small{color:var(--atlas-muted,#91a2b2)!important;font-size:10px}.waiting{font-size:11px!important}.detail{font-family:var(--atlas-mono,monospace);font-size:11px!important;word-break:break-word}
</style>
