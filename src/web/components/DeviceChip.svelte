<script lang="ts">
  import {onMount} from 'svelte';
  import {deviceDirectory, describeContext, openDevice} from '../lib/device-directory.js';
  import {deviceLabelStore} from '../lib/device-identity.js';

  /** A context shown by its Atlas label and name; clicking opens the Device. */
  export let contextId = '';
  export let compact = false;
  let revision = 0;
  onMount(() => {
    const labels = deviceLabelStore.subscribe(() => revision++), appearance = () => revision++;
    window.addEventListener('atlas:device-appearance-changed', appearance);
    return () => { labels(); window.removeEventListener('atlas:device-appearance-changed', appearance); };
  });
  $: identity = revision >= 0 ? describeContext(contextId, $deviceDirectory) : describeContext(contextId, $deviceDirectory);
  $: title = `${identity.label}${identity.name ? ` · ${identity.name}` : ''}${identity.online === false ? ' · offline' : identity.online ? ' · online' : ''}`;
</script>

{#if identity.kind === 'other'}<span class="device-chip plain">{identity.label}</span>
{:else}<button type="button" class="device-chip" class:compact class:offline={identity.online === false} style={identity.color ? `--chip-color:var(--atlas-device-${identity.color})` : ''} {title} aria-label={`Open ${title}`} onclick={(event) => { event.stopPropagation(); openDevice(contextId); }}><b>{identity.glyph}</b><strong>{identity.label}</strong>{#if identity.name && !compact}<small>{identity.name}</small>{/if}{#if identity.online !== undefined}<i class:online={identity.online} aria-hidden="true"></i>{/if}</button>{/if}

<style>
  .device-chip{font-family:Inter,ui-sans-serif,system-ui,sans-serif;display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:100%;padding:1px 6px 1px 2px;border:1px solid color-mix(in srgb,var(--chip-color,var(--atlas-muted)) 45%,transparent);border-radius:999px;background:color-mix(in srgb,var(--chip-color,var(--atlas-muted)) 10%,transparent);color:var(--atlas-text);font:inherit;font-size:11px;line-height:16px;cursor:pointer;vertical-align:middle}
  .device-chip:hover,.device-chip:focus-visible{border-color:var(--chip-color,var(--atlas-accent));outline:none}
  .device-chip b{display:grid;place-items:center;flex:none;width:16px;height:16px;border-radius:50%;background:var(--chip-color,var(--atlas-muted));color:#0b0f14;font-size:8px;font-weight:800}
  .device-chip strong{font-weight:600;white-space:nowrap}
  .device-chip small{overflow:hidden;color:var(--atlas-muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
  .device-chip i{flex:none;width:6px;height:6px;border-radius:50%;background:var(--atlas-muted)}
  .device-chip i.online{background:var(--atlas-success,#4ade80)}
  .device-chip.offline{opacity:.7}
  .device-chip.plain{padding:0;border:0;background:none;cursor:default}
</style>
