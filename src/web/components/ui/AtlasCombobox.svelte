<script lang="ts">
  export let value=''; export let options:{value:string;label:string;detail?:string}[]=[]; export let placeholder='Search or select…'; export let ariaLabel='Select option'; export let disabled=false; let open=false;
  $: filtered=options.filter(option=>option.label.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
  function choose(option:{value:string;label:string}){value=option.value;open=false;}
</script>
<div class="atlas-combobox"><input class="atlas-input" bind:value {placeholder} {disabled} aria-label={ariaLabel} role="combobox" aria-expanded={open} aria-controls="atlas-combobox-options" onfocus={()=>open=true} onkeydown={(event)=>{if(event.key==='Escape')open=false}}/>{#if open&&!disabled}<div id="atlas-combobox-options" role="listbox">{#each filtered as option}<button type="button" role="option" aria-selected={value===option.value} onclick={()=>choose(option)}><b>{option.label}</b>{#if option.detail}<small>{option.detail}</small>{/if}</button>{/each}{#if !filtered.length}<span>No matching options</span>{/if}</div>{/if}</div>
