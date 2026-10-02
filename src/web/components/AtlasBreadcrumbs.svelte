<script lang="ts">export let items:Array<{id:string;label:string;kind:string}>=[];export let onenter:(id:string)=>void=()=>{};</script>
<nav class="atlas-breadcrumbs" aria-label="Atlas breadcrumb">{#each items as item,index}<button onclick={()=>onenter(item.id)} title={`Open ${item.kind}`}>{item.label}</button>{#if index<items.length-1}<span>›</span>{/if}{:else}<span>Device</span>{/each}</nav>
