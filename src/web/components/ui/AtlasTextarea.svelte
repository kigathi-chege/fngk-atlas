<script lang="ts">
  export let value=''; export let placeholder=''; export let disabled=false; export let rows:number|undefined; export let ariaLabel:string|undefined; export let maxlength:number|undefined; export let oninput:((event:Event)=>void)|undefined;
</script>
<textarea class="atlas-textarea" bind:value {placeholder} {disabled} {rows} {maxlength} aria-label={ariaLabel} {oninput}></textarea>
