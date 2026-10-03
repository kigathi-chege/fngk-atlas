<script lang="ts">
  export let value=''; export let options:{value:string;label:string;disabled?:boolean}[]=[]; export let disabled=false; export let ariaLabel:string|undefined; export let onchange:((event:Event)=>void)|undefined;
</script>
<span class="atlas-select"><select bind:value {disabled} aria-label={ariaLabel} {onchange}>{#each options as option}<option value={option.value} disabled={option.disabled}>{option.label}</option>{/each}</select></span>
