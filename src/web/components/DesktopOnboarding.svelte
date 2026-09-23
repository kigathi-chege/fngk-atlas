<script lang="ts">
  import {onMount} from 'svelte';
  import {api} from '../lib/api.js';
  import {openAuthorizationUrl} from '../lib/external-url.js';
  import {resolveOnboardingPresentation} from '../lib/onboarding-state.js';
  import FngkStatusCard from './FngkStatusCard.svelte';
  let status:any,loading=true,error='',origin='';
  $: presentation=resolveOnboardingPresentation(status,error);
  const refresh=async()=>{loading=true;error='';try{status=await api('/api/onboarding/status')}catch(cause){error=(cause as Error).message}finally{loading=false}};
  const converge=async()=>{loading=true;error='';try{await api('/api/onboarding/converge',{method:'POST',body:JSON.stringify({profile:status?.local?.profile??'local',confirm:true})});await refresh()}catch(cause){error=(cause as Error).message;loading=false}};
  const login=async()=>{loading=true;error='';try{const selected=origin.trim();if(!selected)throw new Error('Enter the HTTPS Signal origin.');const flow:any=await api('/api/onboarding/login/begin',{method:'POST',body:JSON.stringify({profile:status?.local?.profile??'local',origin:selected})});await openAuthorizationUrl(flow.authorizationUrl);await api('/api/onboarding/login/complete',{method:'POST',body:JSON.stringify({stateId:flow.stateId,origin:selected,receivedAt:new Date().toISOString()})});await refresh()}catch(cause){error=(cause as Error).message;loading=false}};
  onMount(()=>{void refresh()});
</script>

{#if presentation.kind!=='quiet'}{#if loading && !status && !error}<aside class="desktop-onboarding" aria-label="Atlas connection"><FngkStatusCard {status}/></aside>
{:else}<aside class="desktop-onboarding" aria-label={presentation.kind==='atlas-unavailable'?'Atlas connection':'FNGK setup'}>{#if presentation.kind==='setup'}<FngkStatusCard {status}/>{/if}<div class="setup-copy"><h2>{presentation.title}</h2><p>{presentation.message}</p>{#if presentation.kind==='atlas-unavailable'}<button onclick={refresh} disabled={loading}>{presentation.action}</button>{:else if status?.state==='daemon-install-choice'}<button onclick={converge} disabled={loading}>Start FNGK daemon</button>{:else if status?.state==='login-choice'}<label>Signal origin<input bind:value={origin} placeholder="https://signal.example.test" inputmode="url"/></label><button onclick={login} disabled={loading}>Open secure sign-in</button>{:else if status?.state==='install-choice'||status?.state==='update-choice'}<p class="hint">The signed desktop installer will be available in the packaged Atlas companion. This web host will not replace a local executable automatically.</p>{:else}<button onclick={refresh} disabled={loading}>Try again</button>{/if}{#if error}<small role="alert">{error}</small>{/if}</div></aside>{/if}{/if}

<style>
  .desktop-onboarding{position:fixed;z-index:40;bottom:12px;right:12px;display:grid;gap:8px;width:min(340px,calc(100vw - 24px));padding:10px;border:1px solid var(--atlas-border,#283847);border-radius:10px;background:color-mix(in srgb,var(--atlas-panel,#111a23) 96%,#000);box-shadow:0 12px 34px #0008}.setup-copy{display:grid;gap:8px}.setup-copy h2{margin:0;font-size:14px}.setup-copy p{margin:0;color:var(--atlas-muted,#91a2b2);font-size:12px;line-height:1.4}.setup-copy label{display:grid;gap:4px;font-size:11px}.setup-copy input{padding:7px;border:1px solid var(--atlas-border,#283847);border-radius:6px;background:#0a1118;color:inherit}.setup-copy button{justify-self:start;padding:7px 10px;border:0;border-radius:6px;background:#3e9f8e;color:#07110f;font-weight:700}.setup-copy button:disabled{opacity:.6}.setup-copy small{color:#f3a33b}.hint{font-size:11px!important}
</style>
