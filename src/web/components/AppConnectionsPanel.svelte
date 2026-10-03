<script lang="ts">
  import {onMount} from 'svelte';
  import {api} from '../lib/api.js';
  import {openAuthorizationUrl} from '../lib/external-url.js';
  let origin='https://calculator.signol.org', configured=false, connection:any=null, message='';
  async function refresh(){try{const value=await api<any>('/api/app-connections/status');configured=value.configured;connection=value.connection}catch(error){message=(error as Error).message}}
  async function connect(){message='Opening Calculator authorization…';try{const value=await api<any>('/api/app-connections/connect',{method:'POST',body:JSON.stringify({origin})});await openAuthorizationUrl(value.authorizationUrl);message='Approve the connection in Calculator, then return here.';const timer=window.setInterval(async()=>{await refresh();if(configured){window.clearInterval(timer);message='Calculator connected.';window.dispatchEvent(new Event('atlas:open-agent-chat'))}},1200)}catch(error){message=(error as Error).message}}
  async function disconnect(){await api('/api/app-connections',{method:'DELETE'});await refresh();message='Calculator disconnected from this Atlas installation.'}
  onMount(()=>{void refresh()});
</script>
<section class="panel app-connections" aria-label="App connections">
  <header><strong>App connections</strong><small>{configured?'Connected':'Not connected'}</small></header>
  <p>Connect Atlas to Calculator using your Calculator sign-in. Atlas stores the resulting revocable credential locally; it never asks for a copied token.</p>
  {#if configured}
    <div class="connection"><strong>{connection?.name ?? 'Calculator'}</strong><span>{connection?.origin}</span><small>Expires {connection?.expiresAt || 'unknown'}</small><button onclick={disconnect}>Disconnect</button></div>
  {:else}
    <label>Calculator URL <input bind:value={origin} placeholder="https://calculator.example.org" /></label>
    <button onclick={connect}>Connect Calculator</button>
  {/if}
  {#if message}<p class="message" role="status">{message}</p>{/if}
</section>
<style>.app-connections{padding:16px;display:grid;gap:12px;align-content:start}.app-connections header{display:flex;justify-content:space-between}.app-connections p,.app-connections small{color:var(--atlas-muted,#9da8ad);line-height:1.45}.app-connections label{display:grid;gap:6px}.app-connections input{padding:8px;border:1px solid var(--atlas-border,#465057);background:var(--atlas-input,#171b1e);color:inherit;border-radius:6px}.app-connections button{justify-self:start;padding:8px 11px;border:0;border-radius:6px;background:var(--atlas-accent,#a3ff12);color:#071000;cursor:pointer}.connection{display:grid;gap:5px;padding:12px;border:1px solid var(--atlas-border,#465057);border-radius:8px}.connection span{word-break:break-all}.message{margin:0}</style>
