<script lang="ts">
  export let value=''; export let type='text'; export let placeholder=''; export let disabled=false; export let required=false; export let id:string|undefined; export let ariaLabel:string|undefined; export let autocomplete:string|undefined; export let min:string|number|undefined; export let max:string|number|undefined; export let oninput:((event:Event)=>void)|undefined; export let onchange:((event:Event)=>void)|undefined; export let onkeydown:((event:KeyboardEvent)=>void)|undefined;
</script>
<input class="atlas-input" {id} {type} bind:value {placeholder} {disabled} {required} {autocomplete} {min} {max} aria-label={ariaLabel} {oninput} {onchange} {onkeydown}/>
